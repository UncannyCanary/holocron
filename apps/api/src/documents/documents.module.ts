import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { DocumentsController } from './documents.controller.js';

@Module({
  imports: [DbModule, JobsModule],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
