import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { UploadController } from './upload.controller.js';

@Module({
  imports: [DbModule, JobsModule, WorkspaceModule],
  controllers: [UploadController],
})
export class UploadsModule {}
