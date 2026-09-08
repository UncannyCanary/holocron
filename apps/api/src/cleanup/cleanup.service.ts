import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { PG_BOSS } from '../jobs/jobs.module.js';
import { cleanupUntouchedWorkspaces } from './cleanup-workspaces.js';

const QUEUE_NAME = 'cleanup-workspaces';
// Every night at 3am UTC, matching the backup cron on the same server.
const CRON = '0 3 * * *';

@Injectable()
export class CleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    @Inject(DB) private readonly db: Db,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.PROCESS_ROLE !== 'worker' || process.env.NODE_ENV === 'test') {
      return;
    }

    await this.boss.createQueue(QUEUE_NAME);
    await this.boss.schedule(QUEUE_NAME, CRON, null, { tz: 'Etc/UTC' });
    await this.boss.work(QUEUE_NAME, async () => {
      const { deletedWorkspaces } = await cleanupUntouchedWorkspaces(this.db);
      if (deletedWorkspaces > 0) {
        this.logger.log(`Deleted ${deletedWorkspaces} workspace(s) untouched for 14 days.`);
      }
    });
  }
}
