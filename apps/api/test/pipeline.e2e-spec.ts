import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import type { DocumentType } from '@holocron/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { PDFDocument } from 'pdf-lib';
import type { PgBoss } from 'pg-boss';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { signWorkspaceCookie, WORKSPACE_COOKIE_NAME } from '../src/cookie/workspace-cookie.js';
import { createDb, type Db } from '../src/db/client.js';
import { check, document, field, run, runStep, workspace } from '../src/db/schema.js';
import { PG_BOSS, PROCESS_DOCUMENT } from '../src/jobs/jobs.module.js';
import { stopOcrWorker } from '../src/pages/ocr-pages.js';
import { samplesPath } from '../src/paths.js';
import { MODEL_CLIENT } from '../src/pipeline/model-client.js';
import { PipelineService } from '../src/pipeline/pipeline.service.js';

// No door, so a request only needs the workspace cookie.
process.env.ACCESS_CODE = '';
process.env.COOKIE_SECRET ??= 'test-cookie-secret';
process.env.DATABASE_URL ??= 'postgres://holocron:holocron@localhost:5432/holocron_test';

// Page images, uploads and the OCR language file go under .scratch, not the
// /data volume a container would have.
const scratch = fileURLToPath(new URL('../../../.scratch/data', import.meta.url));
process.env.DATA_DIR ??= scratch;
process.env.OCR_CACHE_DIR ??= path.join(scratch, 'tesseract');

// Reading the receipt photo is real OCR, so give each document room.
const SLOW = 300_000;

type Sample = { type: DocumentType; file: string };

// One sample per type: the ones task 7 recorded a real model answer for.
const SAMPLES: Sample[] = [
  { type: 'invoice', file: 'invoices/invoice-3-planted-error.pdf' },
  { type: 'invoice', file: 'invoices/invoice-4-gst.pdf' },
  { type: 'receipt', file: 'receipts/cord-receipt-1.jpg' },
  { type: 'contract', file: 'contracts/common-paper-mutual-nda.pdf' },
];

function recordedAnswer(name: string): { usage: unknown; output: unknown } {
  const file = fileURLToPath(new URL(`../src/extract/fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8'));
}

function expectedFor(sample: Sample) {
  const file = samplesPath(sample.file).replace(/\.[^.]+$/, '.expected.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Stands in for the model. It picks the recorded answer from the type rules
// in the prompt, so the pipeline runs end to end without the network and
// without spending anything.
function fixtureClient(): Anthropic {
  const typeOf = (system: string): DocumentType => {
    if (system.includes('is an invoice')) return 'invoice';
    if (system.includes('is a shop receipt')) return 'receipt';
    return 'contract';
  };
  return {
    messages: {
      countTokens: async () => ({ input_tokens: 3000 }),
      parse: async (body: {
        system: Array<{ text: string }>;
        messages: Array<{ content: Array<{ type: string; text?: string }> }>;
      }) => {
        const blocks = body.messages[0].content;
        // The first look at a file: one document unless the pages carry two
        // different sellers, which is how the two invoice file is built.
        if (body.system[0].text.includes('how many separate documents')) {
          const pageCount = blocks.filter((block) => block.type === 'image').length;
          const words = blocks.map((block) => block.text ?? '').join('\n');
          const two = words.includes('Cedar & Finch') && words.includes('Northlake');
          const documents = two
            ? [
                { type: 'invoice', pages: [1] },
                { type: 'invoice', pages: [2] },
              ]
            : [{ type: 'invoice', pages: Array.from({ length: pageCount }, (_, i) => i + 1) }];
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 500, output_tokens: 40 },
            parsed_output: { documents },
          };
        }
        const type = typeOf(body.system[0].text);
        // Two invoices share one type. The GST one is the one whose page
        // words mention a GSTIN.
        const pageWords = body.messages[0].content.map((block) => block.text ?? '').join('\n');
        const answer = recordedAnswer(
          type === 'invoice' && pageWords.includes('GSTIN') ? 'invoice-gst' : type,
        );
        return { stop_reason: 'end_turn', usage: answer.usage, parsed_output: answer.output };
      },
    },
  } as unknown as Anthropic;
}

// The names in an expected file, written for a person, next to the names the
// checks use in code.
const CHECK_NAMES: Record<string, string> = {
  'line quantity times price equals line total': 'line_math',
  'line taxable value plus tax equals line total': 'line_tax',
  'taxable value plus taxes equals total': 'total',
  'sum of line totals equals subtotal': 'subtotal',
  'subtotal plus tax minus discount equals total': 'total',
  'issue date on or before due date': 'date_order',
  'one currency throughout': 'one_currency',
  'invoice number present': 'invoice_number',
  'cash tendered minus total equals change': 'change',
  'effective date on or before start date': 'effective_before_start',
  'start date before end date': 'start_before_end',
  'every party named in the opening appears in the signature block': 'party_signed',
  'every defined term is used at least once after it is defined': 'term_used',
};

// Every value an expected file names, by the field name our tables use. The
// defined terms are left out: the model finds more of them than the expected
// file lists, so they are checked on their own.
function wantedValues(expected: {
  fields?: Record<string, unknown>;
  line_items?: Array<Record<string, unknown>>;
}): Record<string, string | number> {
  const wanted: Record<string, string | number> = {};

  for (const [name, node] of Object.entries(expected.fields ?? {})) {
    if (name === 'defined_terms') continue;
    if (name === 'tax_lines' && Array.isArray(node)) {
      node.forEach((item, index) => {
        wanted[`tax_lines.${index}.amount`] = (item as { amount: number }).amount;
      });
      continue;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        wanted[`${name}.${index}`] = (item as { value: string }).value;
      });
      continue;
    }
    wanted[name] = (node as { value: string | number }).value;
  }

  (expected.line_items ?? []).forEach((line, index) => {
    for (const part of [
      'description',
      'quantity',
      'unit_price',
      'discount',
      'taxable_value',
      'tax',
      'line_total',
    ]) {
      if (line[part] !== undefined) {
        wanted[`line_items.${index}.${part}`] = line[part] as string | number;
      }
    }
  });

  return wanted;
}

// A field row holds its value as text. An amount written 165.00 on the page
// is held as 165, so amounts are compared as numbers.
function sameValue(stored: string | null, wanted: string | number): boolean {
  if (stored === null) return false;
  return typeof wanted === 'number' ? Number(stored) === wanted : stored === wanted;
}

describe('the pipeline, end to end', () => {
  let app: INestApplication;
  let db: Db;
  let pipeline: PipelineService;
  let boss: PgBoss;
  let workspaceId: string;
  let cookie: string;

  // Every document this test made, by type.
  const documents = new Map<string, string>();
  let uploadedId: string;

  beforeAll(async () => {
    db = createDb();
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODEL_CLIENT)
      .useValue(fixtureClient())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    pipeline = app.get(PipelineService);
    boss = app.get<PgBoss>(PG_BOSS);

    const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    workspaceId = ws.id;
    cookie = `${WORKSPACE_COOKIE_NAME}=${signWorkspaceCookie({ unlocked: true, workspaceId })}`;
  }, SLOW);

  afterAll(async () => {
    await app.close();
    await stopOcrWorker();
    await db.$client.end();
  });

  for (const sample of SAMPLES) {
    it(
      `reads ${sample.file} and matches its expected file`,
      async () => {
        const [doc] = await db
          .insert(document)
          .values({
            workspaceId,
            type: sample.type,
            status: 'queued',
            filePath: samplesPath(sample.file),
          })
          .returning();
        documents.set(sample.type === 'invoice' ? sample.file : sample.type, doc.id);

        await pipeline.run(doc.id);

        const [after] = await db.select().from(document).where(eq(document.id, doc.id));
        expect(after.status).toBe('ready');

        // The timeline: every step of the run, in order, ending in done.
        const [attempt] = await db.select().from(run).where(eq(run.documentId, doc.id));
        expect(attempt.endedAt).not.toBeNull();
        expect(attempt.error).toBeNull();
        expect(attempt.model).toBe('claude-opus-5');
        expect(attempt.inputTokens).toBeGreaterThan(0);

        const steps = await db
          .select()
          .from(runStep)
          .where(eq(runStep.runId, attempt.id))
          .orderBy(runStep.startedAt);
        expect(steps.map((step) => step.name)).toEqual([
          'received',
          'rendered',
          'text_layer',
          'split',
          'extracted',
          'grounded',
          'checked',
          'done',
        ]);
        expect(steps.every((step) => step.endedAt !== null && step.error === null)).toBe(true);

        const expected = expectedFor(sample);
        const fields = await db.select().from(field).where(eq(field.documentId, doc.id));
        const byName = new Map(fields.map((row) => [row.name, row]));

        for (const [name, wanted] of Object.entries(wantedValues(expected))) {
          const found = byName.get(name);
          expect(found, `no field named ${name}`).toBeTruthy();
          expect(
            sameValue(found?.value ?? null, wanted),
            `${name} is ${found?.value}, expected ${wanted}`,
          ).toBe(true);
        }

        const checks = await db.select().from(check).where(eq(check.documentId, doc.id));
        const matching = (prefix: string) =>
          checks.filter((row) => row.name === prefix || row.name.startsWith(`${prefix}.`));

        for (const wanted of expected.checks as Array<{ name: string; result: string }>) {
          const prefix = CHECK_NAMES[wanted.name];
          expect(prefix, `no check in code for "${wanted.name}"`).toBeTruthy();
          const found = matching(prefix);

          if (wanted.result === 'not_applicable') {
            expect(found, `${prefix} should not have run`).toHaveLength(0);
          } else if (wanted.result === 'pass') {
            expect(found.length, `${prefix} did not run`).toBeGreaterThan(0);
            expect(
              found.every((row) => row.passed),
              `${prefix} should pass`,
            ).toBe(true);
          } else {
            expect(
              found.some((row) => !row.passed),
              `${prefix} should fail`,
            ).toBe(true);
          }
        }
      },
      SLOW,
    );
  }

  it('boxes the invoice values it found on the page, and contradicts the planted error', async () => {
    const documentId = documents.get('invoices/invoice-3-planted-error.pdf') as string;
    const fields = await db.select().from(field).where(eq(field.documentId, documentId));
    const byName = new Map(fields.map((row) => [row.name, row]));

    // Every value printed on this invoice was found in our own text layer, so
    // every one of them has a box.
    for (const name of ['vendor', 'invoice_number', 'issue_date', 'total', 'subtotal']) {
      expect(byName.get(name)?.x0, `${name} has no box`).not.toBeNull();
      expect(byName.get(name)?.pageId).toBeTruthy();
    }

    // The toner line prints 12.00 where 2 times 60.00 is 120.00. The line
    // total is the value the failed check works out, so it is contradicted,
    // and the subtotal it feeds is contradicted too.
    expect(byName.get('line_items.1.line_total')?.trust).toBe('contradicted');
    expect(byName.get('subtotal')?.trust).toBe('contradicted');
    expect(byName.get('line_items.1.quantity')?.trust).toBe('verified');
    expect(byName.get('vendor')?.trust).toBe('verified');

    // A value the document does not print at all can never be confirmed.
    expect(byName.get('discount')?.value).toBeNull();
    expect(byName.get('discount')?.trust).toBe('unverifiable');
  });

  // Known limit from task 5: OCR reads the amounts at the foot of the receipt
  // photo but not every item line, and the model reads the item names off the
  // picture without a quote. Those fields are unverifiable, which is the
  // honest answer, not a match.
  it('leaves the receipt lines unverifiable', async () => {
    const documentId = documents.get('receipt') as string;
    const fields = await db.select().from(field).where(eq(field.documentId, documentId));
    const byName = new Map(fields.map((row) => [row.name, row]));

    // OCR does read the amounts at the foot, so these two are matched.
    for (const name of ['total', 'cash']) {
      expect(byName.get(name)?.value).toBe('91000');
      expect(byName.get(name)?.currency).toBe('IDR');
      expect(byName.get(name)?.x0, `${name} should have a box`).not.toBeNull();
      expect(byName.get(name)?.trust).toBe('verified');
    }

    for (const name of [
      'line_items.0.description',
      'line_items.0.line_total',
      'line_items.1.line_total',
      'line_items.2.line_total',
    ]) {
      expect(byName.get(name)?.x0, `${name} should have no box`).toBeNull();
      expect(byName.get(name)?.trust).toBe('unverifiable');
    }
  });

  it('finds the defined terms the contract expected file names', async () => {
    const documentId = documents.get('contract') as string;
    const expected = expectedFor(SAMPLES.find((sample) => sample.type === 'contract') as Sample);
    const fields = await db.select().from(field).where(eq(field.documentId, documentId));
    const terms = fields.filter((row) => /^defined_terms\.\d+\.term$/.test(row.name));

    for (const wanted of expected.fields.defined_terms as Array<{ term: string }>) {
      expect(
        terms.some((row) => row.value === wanted.term),
        `the contract should define ${wanted.term}`,
      ).toBe(true);
    }
  });

  it('saves a correction, runs every check again, and logs what changed', async () => {
    const documentId = documents.get('invoices/invoice-3-planted-error.pdf') as string;
    const [wrong] = await db
      .select()
      .from(field)
      .where(and(eq(field.documentId, documentId), eq(field.name, 'line_items.1.line_total')));

    const res = await request(app.getHttpServer())
      .post(`/api/fields/${wrong.id}/correction`)
      .set('Cookie', cookie)
      .send({ value: '120' });

    expect(res.status).toBe(201);
    // 2 times 60.00 is 120.00, and 45.00 plus 120.00 is the 165.00 subtotal,
    // so both failing checks turn green together.
    expect(res.body.changedChecks).toEqual(['line_math.1', 'subtotal']);

    const checks = new Map(
      (res.body.checks as Array<{ name: string; passed: boolean }>).map((row) => [
        row.name,
        row.passed,
      ]),
    );
    expect(checks.get('line_math.1')).toBe(true);
    expect(checks.get('subtotal')).toBe(true);

    const [corrected] = await db.select().from(field).where(eq(field.id, wrong.id));
    expect(corrected.value).toBe('120');
    expect(corrected.trust).toBe('corrected');
    // The box is kept, so the reviewer can still see where the value came from.
    expect(corrected.x0).not.toBeNull();

    // The subtotal was only contradicted because of that line, so it is back
    // to verified now.
    const [subtotal] = await db
      .select()
      .from(field)
      .where(and(eq(field.documentId, documentId), eq(field.name, 'subtotal')));
    expect(subtotal.trust).toBe('verified');
  });

  it('takes an upload, writes the rows, and puts the job on the queue', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/documents')
      .set('Cookie', cookie)
      .field('type', 'invoice')
      .attach('file', samplesPath('invoices/invoice-1-clean.pdf'));

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('queued');
    uploadedId = res.body.id;

    const [uploaded] = await db.select().from(document).where(eq(document.id, res.body.id));
    expect(uploaded.workspaceId).toBe(workspaceId);
    expect(uploaded.type).toBe('invoice');

    // The run is open with its first step written, waiting for the worker.
    const [attempt] = await db.select().from(run).where(eq(run.documentId, uploaded.id));
    const steps = await db.select().from(runStep).where(eq(runStep.runId, attempt.id));
    expect(steps.map((step) => step.name)).toEqual(['received']);

    // The job went on the queue in the same transaction as the rows. Asked
    // for by its document rather than by state, since a worker running beside
    // this test may already have picked it up.
    const jobs = await boss.findJobs(PROCESS_DOCUMENT, { data: { documentId: uploaded.id } });
    expect(jobs).toHaveLength(1);
  });

  it(
    'splits a file that holds two invoices into two documents',
    async () => {
      // Two sample invoices stapled into one file, the way a marketplace
      // order with two sellers arrives.
      const merged = await PDFDocument.create();
      for (const file of ['invoices/invoice-1-clean.pdf', 'invoices/invoice-2-clean.pdf']) {
        const source = await PDFDocument.load(readFileSync(samplesPath(file)));
        const [copied] = await merged.copyPages(source, [0]);
        merged.addPage(copied);
      }
      const dir = mkdtempSync(path.join(tmpdir(), 'holocron-two-'));
      const filePath = path.join(dir, 'two-invoices.pdf');
      writeFileSync(filePath, await merged.save());

      const [uploaded] = await db
        .insert(document)
        .values({ workspaceId, type: 'invoice', status: 'queued', filePath })
        .returning();

      await pipeline.run(uploaded.id);

      const [first] = await db.select().from(document).where(eq(document.id, uploaded.id));
      expect(first.status).toBe('ready');
      expect(first.pageNumbers).toEqual([1]);

      const [second] = await db.select().from(document).where(eq(document.sourceId, uploaded.id));
      expect(second).toBeTruthy();
      expect(second.pageNumbers).toEqual([2]);
      expect(second.status).toBe('queued');
      expect(second.workspaceId).toBe(workspaceId);

      // The second document's job is on the queue; running it reads page 2.
      const jobs = await boss.findJobs(PROCESS_DOCUMENT, { data: { documentId: second.id } });
      expect(jobs).toHaveLength(1);
      await pipeline.run(second.id);
      const [after] = await db.select().from(document).where(eq(document.id, second.id));
      expect(after.status).toBe('ready');

      // Each shows only its own page on the review screen.
      const detail = await request(app.getHttpServer())
        .get(`/api/documents/${second.id}`)
        .set('Cookie', cookie);
      expect(detail.status).toBe(200);
      expect(detail.body.pages.map((each: { number: number }) => each.number)).toEqual([2]);
      const firstDetail = await request(app.getHttpServer())
        .get(`/api/documents/${uploaded.id}`)
        .set('Cookie', cookie);
      expect(firstDetail.body.pages.map((each: { number: number }) => each.number)).toEqual([1]);

      // The split is a step on the first document's timeline.
      const [attempt] = await db.select().from(run).where(eq(run.documentId, uploaded.id));
      const steps = await db.select().from(runStep).where(eq(runStep.runId, attempt.id));
      expect(steps.map((step) => step.name)).toContain('split');
    },
    SLOW,
  );

  it('deletes a document along with its rows and files', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/documents')
      .set('Cookie', cookie)
      .field('type', 'invoice')
      .attach('file', samplesPath('invoices/invoice-2-clean.pdf'));
    expect(res.status).toBe(201);
    const [row] = await db.select().from(document).where(eq(document.id, res.body.id));
    expect(existsSync(row.filePath)).toBe(true);

    const gone = await request(app.getHttpServer())
      .delete(`/api/documents/${res.body.id}`)
      .set('Cookie', cookie);
    expect(gone.status).toBe(204);

    expect(await db.select().from(document).where(eq(document.id, res.body.id))).toHaveLength(0);
    expect(existsSync(row.filePath)).toBe(false);

    const again = await request(app.getHttpServer())
      .delete(`/api/documents/${res.body.id}`)
      .set('Cookie', cookie);
    expect(again.status).toBe(404);
  });

  it(
    'runs the uploaded document the same way the worker would',
    async () => {
      await pipeline.run(uploadedId);

      const [after] = await db.select().from(document).where(eq(document.id, uploadedId));
      expect(after.status).toBe('ready');

      const checks = await db.select().from(check).where(eq(check.documentId, uploadedId));
      expect(checks.length).toBeGreaterThan(0);
    },
    SLOW,
  );
});
