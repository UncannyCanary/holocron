import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { CorrectionController } from './correction.controller.js';

@Module({
  imports: [DbModule],
  controllers: [CorrectionController],
})
export class CorrectionsModule {}
