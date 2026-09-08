import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { document, run } from '../db/schema.js';
import type { ProcessDocumentJob } from '../jobs/jobs.module.js';
import { resendStalledQueued } from './resend-stalled.js';

// A stand-in for JobsService that just remembers what it was asked to send,
// so the test never has to start a real queue.
function fakeJobs() {
  const sent: ProcessDocumentJob[] = [];
  return { sent, sendProcessDocument: async (job: ProcessDocumentJob) => void sent.push(job) };
}

describe('resendStalledQueued', () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron_test',
  );

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('sends a fresh job for a queued document whose last run already ended', async () => {
    const [doc] = await db
      .insert(document)
      .values({ type: 'invoice', status: 'queued', filePath: `/data/${randomUUID()}.pdf` })
      .returning();
    await db.insert(run).values({
      documentId: doc.id,
      startedAt: new Date(),
      endedAt: new Date(),
      error: 'Holocron is at its monthly processing budget.',
    });

    const jobs = fakeJobs();
    await resendStalledQueued(db, jobs);

    expect(jobs.sent.filter((job) => job.documentId === doc.id)).toEqual([
      { documentId: doc.id, workspaceId: null },
    ]);
  });

  it('leaves a queued document alone while its first run is still open', async () => {
    const [doc] = await db
      .insert(document)
      .values({ type: 'invoice', status: 'queued', filePath: `/data/${randomUUID()}.pdf` })
      .returning();
    await db.insert(run).values({ documentId: doc.id, startedAt: new Date(), endedAt: null });

    const jobs = fakeJobs();
    await resendStalledQueued(db, jobs);

    expect(jobs.sent.filter((job) => job.documentId === doc.id)).toEqual([]);
  });

  it('leaves alone a document that is not queued', async () => {
    const [doc] = await db
      .insert(document)
      .values({ type: 'invoice', status: 'ready', filePath: `/data/${randomUUID()}.pdf` })
      .returning();
    await db.insert(run).values({ documentId: doc.id, startedAt: new Date(), endedAt: new Date() });

    const jobs = fakeJobs();
    await resendStalledQueued(db, jobs);

    expect(jobs.sent.filter((job) => job.documentId === doc.id)).toEqual([]);
  });
});
