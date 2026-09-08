import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CleanupModule } from './cleanup/cleanup.module.js';
import { CorrectionsModule } from './corrections/corrections.module.js';
import { DbModule } from './db/db.module.js';
import { DoorModule } from './door/door.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { RateLimitMiddleware } from './rate-limit/rate-limit.middleware.js';
import { SeedModule } from './seed/seed.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { WorkspaceModule } from './workspace/workspace.module.js';

@Module({
  imports: [
    DbModule,
    JobsModule,
    DoorModule,
    WorkspaceModule,
    SeedModule,
    PipelineModule,
    UploadsModule,
    CorrectionsModule,
    CleanupModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
