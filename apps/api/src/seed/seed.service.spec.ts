import { fileURLToPath } from 'node:url';
import { eq, isNull } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { document, page } from '../db/schema.js';
import type { JobsService } from '../jobs/jobs.module.js';
import { stopOcrWorker } from '../pages/ocr-pages.js';
import { samplesPath } from '../paths.js';
import { SeedService } from './seed.service.js';

// The two receipt photos go through real OCR, so this test is slow the first
// time it runs against a fresh database. Every run after that is instant: it
// finds the rows already there and does nothing.
describe('SeedService', () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron',
  );
  // Seeding puts every unread sample on the queue. This test is about the
  // rows, so the jobs are counted and thrown away.
  const queued: string[] = [];
  const jobs = {
    sendProcessDocument: async ({ documentId }: { documentId: string }) => {
      queued.push(documentId);
    },
  } as unknown as JobsService;
  const seed = new SeedService(db, jobs);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await stopOcrWorker();
    await db.$client.end();
  });

  // Filtered to documents under samples/, not just any canonical document,
  // since other tests in the same real database leave their own canonical
  // fixtures behind with no workspace either.
  async function realSampleDocuments() {
    const canonical = await db.select().from(document).where(isNull(document.workspaceId));
    const samplesDir = samplesPath();
    return canonical.filter((doc) => doc.filePath.startsWith(samplesDir));
  }

  it('seeds one canonical document per sample, with its pages, and skips them on a second run', async () => {
    await seed.seedAll();
    const afterFirstRun = await realSampleDocuments();

    await seed.seedAll();
    const afterSecondRun = await realSampleDocuments();
    expect(afterSecondRun).toHaveLength(afterFirstRun.length);

    const countByType = (type: string) => afterSecondRun.filter((doc) => doc.type === type).length;
    expect(countByType('invoice')).toBe(3);
    expect(countByType('receipt')).toBe(2);
    expect(countByType('contract')).toBe(2);

    for (const doc of afterSecondRun) {
      const pages = await db.select().from(page).where(eq(page.documentId, doc.id));
      expect(pages.length).toBeGreaterThan(0);
      expect(pages[0].textLayer).toBeTruthy();
    }
  });
});
