import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';

@Module({
  imports: [JobsModule],
  controllers: [HealthController],
})
export class AppModule {}
