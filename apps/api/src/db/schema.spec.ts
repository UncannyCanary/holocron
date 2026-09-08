import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { check, correction, document, field, page, run, runStep, workspace } from './schema.js';

describe('schema', () => {
  // Falls back to the local Compose database from .env.example so this test
  // runs the same way `pnpm test` does, without needing dotenv wired in.
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron_test',
  );

  // Apply the checked-in migrations so this test works on a fresh database.
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('inserts one row of each table', async () => {
    const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();

    const [doc] = await db
      .insert(document)
      .values({
        workspaceId: ws.id,
        type: 'invoice',
        status: 'queued',
        filePath: '/data/uploads/sample.pdf',
      })
      .returning();

    const [pg] = await db
      .insert(page)
      .values({
        documentId: doc.id,
        number: 1,
        imagePath: '/data/pages/sample-1.png',
        widthPx: 1700,
        heightPx: 2200,
        widthPt: 612,
        heightPt: 792,
        textLayer: [{ text: 'Total', x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.22 }],
      })
      .returning();

    const [fld] = await db
      .insert(field)
      .values({
        documentId: doc.id,
        name: 'total',
        value: '100.00',
        pageId: pg.id,
        x0: 0.1,
        y0: 0.2,
        x1: 0.2,
        y1: 0.22,
        quote: '100.00',
        trust: 'verified',
      })
      .returning();

    const [chk] = await db
      .insert(check)
      .values({
        documentId: doc.id,
        name: 'total_matches_subtotal',
        passed: true,
        message: 'The total matches the subtotal.',
        blamedFieldIds: [],
        flaggedFieldIds: [fld.id],
      })
      .returning();

    const [corr] = await db
      .insert(correction)
      .values({
        fieldId: fld.id,
        oldValue: '100.00',
        newValue: '110.00',
      })
      .returning();

    const [rn] = await db
      .insert(run)
      .values({
        documentId: doc.id,
        model: 'claude-opus-5',
        inputTokens: 1200,
        outputTokens: 300,
      })
      .returning();

    const [step] = await db
      .insert(runStep)
      .values({
        runId: rn.id,
        name: 'extracted',
        startedAt: new Date(),
        endedAt: new Date(),
      })
      .returning();

    expect(ws.id).toBeTruthy();
    expect(doc.id).toBeTruthy();
    expect(pg.id).toBeTruthy();
    expect(fld.id).toBeTruthy();
    expect(chk.id).toBeTruthy();
    expect(corr.id).toBeTruthy();
    expect(rn.id).toBeTruthy();
    expect(step.id).toBeTruthy();
  });
});
