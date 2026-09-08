import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { document, workspace } from '../db/schema.js';
import { checkDailyUploadQuota, checkFileSize, checkPageCount } from './upload-limits.js';

describe('upload limits', () => {
  it('accepts a file under 10 MB', () => {
    expect(checkFileSize(5 * 1024 * 1024)).toEqual({ ok: true });
  });

  it('rejects a file over 10 MB', () => {
    expect(checkFileSize(11 * 1024 * 1024)).toEqual({
      ok: false,
      message: 'This file is over the 10 MB limit.',
    });
  });

  it('accepts 20 pages or fewer', () => {
    expect(checkPageCount(20)).toEqual({ ok: true });
  });

  it('rejects more than 20 pages', () => {
    expect(checkPageCount(21)).toEqual({
      ok: false,
      message: 'This file has more than 20 pages.',
    });
  });

  describe('daily upload quota', () => {
    const db = createDb(
      process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron',
    );

    beforeAll(async () => {
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
      });
    });

    afterAll(async () => {
      await db.$client.end();
    });

    it('allows uploads under the daily limit and blocks the 11th', async () => {
      const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();

      for (let i = 0; i < 10; i += 1) {
        await db.insert(document).values({
          workspaceId: ws.id,
          type: 'invoice',
          status: 'queued',
          filePath: `/data/uploads/${randomUUID()}.pdf`,
        });
      }

      expect(await checkDailyUploadQuota(db, ws.id)).toEqual({
        ok: false,
        message:
          'This workspace has used its 10 uploads for today. The sample documents still work.',
      });
    });

    it('ignores sample copies, which point back at a canonical document', async () => {
      const [canonical] = await db
        .insert(document)
        .values({ type: 'invoice', status: 'ready', filePath: '/data/canonical.pdf' })
        .returning();
      const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();

      for (let i = 0; i < 10; i += 1) {
        await db.insert(document).values({
          workspaceId: ws.id,
          documentId: canonical.id,
          type: 'invoice',
          status: 'ready',
          filePath: canonical.filePath,
        });
      }

      expect(await checkDailyUploadQuota(db, ws.id)).toEqual({ ok: true });
    });
  });
});
