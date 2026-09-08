import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { SeedService } from './seed.service.js';

@Module({
  imports: [DbModule],
  providers: [SeedService],
})
export class SeedModule {}
