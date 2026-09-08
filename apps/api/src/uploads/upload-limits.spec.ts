import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { document, workspace } from '../db/schema.js';
import {
  checkDailyUploadQuota,
  checkFileSize,
  checkFileType,
  checkFreeSpace,
  checkPageCount,
} from './upload-limits.js';

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

  it('accepts a PDF, a PNG, and a JPEG by their first bytes', () => {
    expect(checkFileType(Buffer.from('%PDF-1.7 rest of file'))).toEqual({ ok: true });
    expect(checkFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).toEqual(
      { ok: true },
    );
    expect(checkFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toEqual({ ok: true });
  });

  it('refuses any other file, whatever its name says', () => {
    expect(checkFileType(Buffer.from('MZ this is a program'))).toEqual({
      ok: false,
      message: 'Holocron takes PDF, PNG, and JPEG files.',
    });
    expect(checkFileType(Buffer.alloc(0))).toEqual({
      ok: false,
      message: 'Holocron takes PDF, PNG, and JPEG files.',
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

  it('accepts an upload while there is more than 2 GB left', () => {
    expect(checkFreeSpace(3 * 1024 * 1024 * 1024)).toEqual({ ok: true });
  });

  it('refuses an upload when the disk is nearly full', () => {
    expect(checkFreeSpace(1024 * 1024 * 1024)).toEqual({
      ok: false,
      message: 'Holocron is out of room for new files right now. The sample documents still work.',
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
