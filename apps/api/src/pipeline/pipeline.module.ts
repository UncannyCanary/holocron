import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MODEL_CLIENT } from './model-client.js';
import { PipelineService } from './pipeline.service.js';
import { PipelineWorker } from './pipeline.worker.js';
import { ResendService } from './resend.service.js';

@Module({
  imports: [DbModule, JobsModule],
  providers: [
    // The key is read from the environment. Building the client without one
    // is fine; only a real call needs it.
    { provide: MODEL_CLIENT, useFactory: () => new Anthropic() },
    PipelineService,
    PipelineWorker,
    ResendService,
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
