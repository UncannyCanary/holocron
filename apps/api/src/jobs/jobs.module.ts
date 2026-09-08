import { Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { DbTransaction } from '../db/client.js';

export const PG_BOSS = Symbol('PG_BOSS');

// The one queue: read a document and work out how far each value can be
// trusted. The worker is the only process that ever takes jobs off it.
export const PROCESS_DOCUMENT = 'process-document';

// What a job carries. The worker reads everything else from our tables.
export type ProcessDocumentJob = {
  documentId: string;
  // Null on a shared sample, which belongs to no workspace.
  workspaceId: string | null;
};

// Jobs are grouped by workspace so that one visitor uploading ten files can
// never hold up another's. A sample belongs to no workspace, so its jobs
// share this group instead.
const SAMPLES_GROUP = 'samples';

@Injectable()
class PgBossShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true, timeout: 45_000 });
  }
}

@Injectable()
export class JobsService {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  // Pass a transaction and the job is sent inside it, so the document row and
  // its job either both land or neither does. A job for a document that was
  // never written would fail every time it was tried. Without one the job is
  // sent on its own, which is what seeding does once its rows are already in.
  async sendProcessDocument(job: ProcessDocumentJob, tx?: DbTransaction): Promise<void> {
    await this.boss.send(PROCESS_DOCUMENT, job, {
      ...(tx === undefined ? {} : { db: fromDrizzle(tx, sql) }),
      group: { id: job.workspaceId ?? SAMPLES_GROUP },
      // One waiting job per document. A restart that sends the samples again
      // while their first jobs are still queued must not read them twice.
      singletonKey: job.documentId,
    });
  }
}

@Module({
  providers: [
    {
      provide: PG_BOSS,
      useFactory: async (): Promise<PgBoss> => {
        const boss = new PgBoss({
          connectionString: process.env.DATABASE_URL,
          application_name: process.env.PROCESS_ROLE ?? 'holocron',
          useListenNotify: process.env.PROCESS_ROLE === 'worker',
        });
        boss.on('error', (err: Error) => Logger.error(err, 'pg-boss'));
        boss.on('warning', (w: { message: string }) => Logger.warn(w.message, 'pg-boss'));
        await boss.start();
        // Both processes run this. It does nothing once the queue exists, and
        // the API cannot send a job to a queue that is not there yet.
        await boss.createQueue(PROCESS_DOCUMENT, {
          notify: true,
          // Two more tries after the first, waiting longer each time.
          retryLimit: 2,
          retryDelay: 10,
          retryBackoff: true,
          // A document that has been in hand for 15 minutes is stuck. Let it
          // go back on the queue rather than hold the worker forever.
          expireInSeconds: 900,
        });
        return boss;
      },
    },
    JobsService,
    PgBossShutdown,
  ],
  exports: [PG_BOSS, JobsService],
})
export class JobsModule {}
