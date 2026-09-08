import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { JobsService, PG_BOSS } from '../jobs/jobs.module.js';
import { resendStalledQueued } from './resend-stalled.js';

const QUEUE_NAME = 'resend-stalled-queued';
// Once a day, clear of the cleanup and backup crons which both run at 3am.
const CRON = '0 4 * * *';

// Catches a document that fell back to queued and was never picked up again:
// a sample parked by the spending cap, or an upload whose job pg-boss
// considers finished even though the document itself is not done.
@Injectable()
export class ResendService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResendService.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.PROCESS_ROLE !== 'worker' || process.env.NODE_ENV === 'test') {
      return;
    }

    await this.boss.createQueue(QUEUE_NAME);
    await this.boss.schedule(QUEUE_NAME, CRON, null, { tz: 'Etc/UTC' });
    await this.boss.work(QUEUE_NAME, async () => {
      const sent = await resendStalledQueued(this.db, this.jobs);
      if (sent > 0) {
        this.logger.log(`Sent ${sent} stalled queued document(s) back to be read.`);
      }
    });
  }
}
