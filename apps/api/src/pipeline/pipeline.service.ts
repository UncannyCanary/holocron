import { readFile } from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import { LIMITS, type PageTextLayer } from '@holocron/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { document, field, page, run, runStep } from '../db/schema.js';
import { extract } from '../extract/extract.js';
import { spentThisMonth } from '../extract/spend.js';
import { ground } from '../ground/ground.js';
import { type BuiltPage, buildPages } from '../pages/pages.js';
import { dataPath } from '../paths.js';
import { checkPageCount } from '../uploads/upload-limits.js';
import { applyChecks } from './apply-checks.js';
import { flattenExtraction } from './flatten.js';
import { MODEL_CLIENT } from './model-client.js';

type StepName = (typeof runStep.name.enumValues)[number];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The steps of a run, in order: received, rendered, text layer, extracted,
// grounded, checked, then done or failed. Each one writes a run step row with
// its start, its end, and anything that went wrong, and that list is the
// document's timeline. The document's status lives in our own tables the
// whole way through, never in the queue's.
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MODEL_CLIENT) private readonly client: Anthropic,
  ) {}

  async run(documentId: string): Promise<void> {
    const [doc] = await this.db.select().from(document).where(eq(document.id, documentId));
    if (!doc) {
      // The workspace was deleted while the job waited. There is nothing left
      // to read, and nothing has gone wrong.
      this.logger.warn(`Document ${documentId} is gone. Nothing to do.`);
      return;
    }

    const attempt = await this.startRun(documentId);
    await this.db.update(document).set({ status: 'processing' }).where(eq(document.id, documentId));

    try {
      const built = await this.step(attempt.id, 'rendered', () =>
        this.renderPages(doc.id, doc.filePath),
      );
      await this.step(attempt.id, 'text_layer', () => this.storePages(doc.id, built));

      const pages = await this.db
        .select()
        .from(page)
        .where(eq(page.documentId, doc.id))
        .orderBy(page.number);

      const result = await this.step(attempt.id, 'extracted', () =>
        this.readWithModel(doc.type, pages),
      );

      // The month's budget is spent. Nothing was sent and nothing was
      // charged, so the document waits in the queue with the reason on its
      // run rather than failing.
      if (result.status === 'parked') {
        await this.endRun(attempt.id, result.reason);
        await this.db.update(document).set({ status: 'queued' }).where(eq(document.id, documentId));
        this.logger.warn(`Document ${documentId} is parked: ${result.reason}`);
        return;
      }
      if (result.status === 'failed') {
        throw new Error(result.error);
      }

      await this.db
        .update(run)
        .set({
          model: result.model,
          // Every input token, cached or not, so the ledger never reads low.
          inputTokens:
            result.usage.input_tokens +
            (result.usage.cache_creation_input_tokens ?? 0) +
            (result.usage.cache_read_input_tokens ?? 0),
          outputTokens: result.usage.output_tokens,
        })
        .where(eq(run.id, attempt.id));

      await this.step(attempt.id, 'grounded', () =>
        this.storeFields(doc.id, result.extraction, pages),
      );
      await this.step(attempt.id, 'checked', () => applyChecks(this.db, doc.id));

      await this.mark(attempt.id, 'done');
      await this.endRun(attempt.id, null);
      await this.db.update(document).set({ status: 'ready' }).where(eq(document.id, documentId));
    } catch (error) {
      const message = messageOf(error);
      await this.mark(attempt.id, 'failed', message);
      await this.endRun(attempt.id, message);
      await this.db.update(document).set({ status: 'failed' }).where(eq(document.id, documentId));
      // Thrown on so the queue retries it. A retry starts a new run and puts
      // the document back to processing.
      throw error;
    }
  }

  // A run is one attempt at a document. The upload route opens the first one
  // when the file lands; a retry that finds no open run opens its own.
  private async startRun(documentId: string) {
    const [open] = await this.db
      .select()
      .from(run)
      .where(and(eq(run.documentId, documentId), isNull(run.endedAt)))
      .orderBy(desc(run.startedAt))
      .limit(1);
    if (open) {
      return open;
    }

    const [fresh] = await this.db.insert(run).values({ documentId }).returning();
    await this.mark(fresh.id, 'received');
    return fresh;
  }

  private async endRun(runId: string, error: string | null): Promise<void> {
    await this.db.update(run).set({ endedAt: new Date(), error }).where(eq(run.id, runId));
  }

  // A step that takes no time of its own: the file arriving, the run ending.
  private async mark(runId: string, name: StepName, error?: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(runStep)
      .values({ runId, name, startedAt: now, endedAt: now, error: error ?? null });
  }

  private async step<T>(runId: string, name: StepName, work: () => Promise<T>): Promise<T> {
    const [row] = await this.db
      .insert(runStep)
      .values({ runId, name, startedAt: new Date() })
      .returning();
    try {
      const done = await work();
      await this.db.update(runStep).set({ endedAt: new Date() }).where(eq(runStep.id, row.id));
      return done;
    } catch (error) {
      await this.db
        .update(runStep)
        .set({ endedAt: new Date(), error: messageOf(error) })
        .where(eq(runStep.id, row.id));
      throw error;
    }
  }

  // Makes a picture of every page and reads the words off it. A document that
  // already has its pages, because an earlier attempt got this far or because
  // it is a shared sample, is left alone: rendering it again would cost
  // minutes of OCR and give the same answer.
  private async renderPages(documentId: string, filePath: string): Promise<BuiltPage[] | null> {
    const [already] = await this.db
      .select({ id: page.id })
      .from(page)
      .where(eq(page.documentId, documentId))
      .limit(1);
    if (already) {
      return null;
    }

    const built = await buildPages(filePath, dataPath('pages', documentId), {
      maxPages: LIMITS.maxPagesPerDocument,
    });
    const room = checkPageCount(built.length);
    if (!room.ok) {
      throw new Error(room.message);
    }
    return built;
  }

  private async storePages(documentId: string, built: BuiltPage[] | null): Promise<void> {
    if (built === null) {
      return;
    }
    for (const each of built) {
      await this.db.insert(page).values({
        documentId,
        number: each.number,
        imagePath: each.imagePath,
        widthPx: each.widthPx,
        heightPx: each.heightPx,
        widthPt: each.widthPt,
        heightPt: each.heightPt,
        textLayer: each.textLayer,
      });
    }
  }

  private async readWithModel(
    type: (typeof document.type.enumValues)[number],
    pages: Array<typeof page.$inferSelect>,
  ) {
    const withImages = await Promise.all(
      pages.map(async (row) => ({
        number: row.number,
        image: await readFile(row.imagePath),
        textLayer: row.textLayer as PageTextLayer,
      })),
    );

    return extract(
      { type, pages: withImages },
      { client: this.client, spentThisMonthUsd: () => spentThisMonth(this.db) },
    );
  }

  // Turns the model's answer into field rows. Every value is looked for in
  // our own text layer, and the box we store is the one our words give, never
  // the model's idea of where it was.
  private async storeFields(
    documentId: string,
    extraction: Parameters<typeof flattenExtraction>[0],
    pages: Array<typeof page.$inferSelect>,
  ): Promise<void> {
    const forGrounding = pages.map((row) => ({
      number: row.number,
      textLayer: row.textLayer as PageTextLayer,
    }));
    const pageIdByNumber = new Map(pages.map((row) => [row.number, row.id]));

    // A re-run replaces what the last one said.
    await this.db.delete(field).where(eq(field.documentId, documentId));

    for (const flat of flattenExtraction(extraction)) {
      const found =
        flat.value === null
          ? null
          : ground({ value: flat.value, quote: flat.quote, page: flat.page }, forGrounding);

      await this.db.insert(field).values({
        documentId,
        name: flat.name,
        value: flat.value,
        currency: flat.currency,
        pageId: found === null ? null : (pageIdByNumber.get(found.page) ?? null),
        x0: found?.box.x0 ?? null,
        y0: found?.box.y0 ?? null,
        x1: found?.box.x1 ?? null,
        y1: found?.box.y1 ?? null,
        quote: flat.quote,
        // The checked step works out the real state. This is what the field
        // would be if no check ran at all.
        trust: found === null ? 'unverifiable' : 'verified',
      });
    }
  }
}
