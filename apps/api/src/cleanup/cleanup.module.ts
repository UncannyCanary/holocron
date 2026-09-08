import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { CleanupService } from './cleanup.service.js';

@Module({
  imports: [DbModule, JobsModule],
  providers: [CleanupService],
})
export class CleanupModule {}
