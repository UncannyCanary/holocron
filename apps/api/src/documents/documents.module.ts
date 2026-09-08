import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { DocumentsController } from './documents.controller.js';

@Module({
  imports: [DbModule],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
