import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { SeedService } from './seed.service.js';

@Module({
  imports: [DbModule, JobsModule],
  providers: [SeedService],
})
export class SeedModule {}
