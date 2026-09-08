import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { document, run } from '../db/schema.js';
import type { JobsService } from '../jobs/jobs.module.js';

// Only the one thing this needs from JobsService, so a test can hand it a
// plain stand-in instead of a real queue.
type SendsJobs = Pick<JobsService, 'sendProcessDocument'>;

// A document the spending cap parked goes back to queued, but its job is
// finished as far as the queue is concerned, so nothing picks it up again on
// its own. This finds every queued document whose last attempt has already
// ended, uploads included, and sends each one a fresh job. A document still
// waiting for its very first attempt has no ended run yet, so it is left
// alone: its first job is already on the queue.
export async function resendStalledQueued(db: Db, jobs: SendsJobs): Promise<number> {
  const queued = await db.select().from(document).where(eq(document.status, 'queued'));

  let sent = 0;
  for (const doc of queued) {
    const sharedId = doc.documentId ?? doc.id;
    const [latest] = await db
      .select({ endedAt: run.endedAt })
      .from(run)
      .where(eq(run.documentId, sharedId))
      .orderBy(desc(run.startedAt))
      .limit(1);

    if (latest?.endedAt) {
      await jobs.sendProcessDocument({ documentId: doc.id, workspaceId: doc.workspaceId });
      sent += 1;
    }
  }
  return sent;
}
