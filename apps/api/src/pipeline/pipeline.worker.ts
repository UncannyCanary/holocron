import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { PG_BOSS, PROCESS_DOCUMENT, type ProcessDocumentJob } from '../jobs/jobs.module.js';
import { stopOcrWorker } from '../pages/ocr-pages.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { PipelineService } from './pipeline.service.js';

// Takes jobs off the queue, one at a time, and runs the pipeline for each.
// Only the worker process does this. The API sends jobs and never takes any.
@Injectable()
export class PipelineWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PipelineWorker.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly pipeline: PipelineService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.PROCESS_ROLE !== 'worker' || process.env.NODE_ENV === 'test') {
      return;
    }

    // One document at a time. Every job already carries its workspace as its
    // group, so turning this number up later shares the worker fairly between
    // visitors without another change.
    await this.boss.work<ProcessDocumentJob>(
      PROCESS_DOCUMENT,
      { localConcurrency: 1 },
      async ([job]) => {
        await this.pipeline.run(job.data.documentId);
      },
    );
    this.logger.log('Waiting for documents.');
  }

  // The OCR worker holds a process of its own open. Letting it go here means
  // the container really stops inside the grace period.
  async onApplicationShutdown(): Promise<void> {
    await stopOcrWorker();
  }
}
