import path from 'node:path';
import type { DocumentType } from '@holocron/shared';
import { Controller, Get, HttpException, HttpStatus, Inject, Req } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { workspaceIdFromCookieHeader } from '../cookie/workspace-cookie.js';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { check, document, field, run, runStep } from '../db/schema.js';
import { NO_WORKSPACE_MESSAGE } from '../workspace/workspace.controller.js';
import {
  counterpartyOf,
  dateOf,
  documentDisplayName,
  summarizeFailed,
  summarizeProcessing,
  summarizeQueued,
  summarizeReady,
  totalOf,
} from './document-summary.js';

type DocumentRow = typeof document.$inferSelect;

// One document, as far as the first-visit and queue screens need it: enough
// to name it, place it worst-first, and say in one line why it sits where it
// sits. The review screen (its full fields, checks, and page boxes) is its
// own route, built separately.
@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@Req() req: Request) {
    const workspaceId = workspaceIdFromCookieHeader(req.headers.cookie);
    if (workspaceId === null) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }

    const documents = await this.db
      .select()
      .from(document)
      .where(eq(document.workspaceId, workspaceId))
      .orderBy(document.createdAt);

    return Promise.all(documents.map((row) => this.summarize(row)));
  }

  private async summarize(doc: DocumentRow) {
    const type = doc.type as DocumentType;
    const fields = await this.db.select().from(field).where(eq(field.documentId, doc.id));
    const fallbackName = path.basename(doc.filePath);

    const summary = {
      id: doc.id,
      type,
      status: doc.status,
      name: documentDisplayName(type, fields, fallbackName),
      counterparty: counterpartyOf(type, fields),
      date: dateOf(type, fields),
      total: totalOf(type, fields),
      isSample: doc.documentId !== null,
      createdAt: doc.createdAt.toISOString(),
    };

    if (doc.status === 'ready') {
      const checks = await this.db.select().from(check).where(eq(check.documentId, doc.id));
      const { trust, why } = summarizeReady(fields, checks);
      return { ...summary, trust, why };
    }

    const [latestRun] = await this.db
      .select()
      .from(run)
      .where(eq(run.documentId, doc.id))
      .orderBy(desc(run.startedAt))
      .limit(1);

    if (doc.status === 'processing') {
      const [latestStep] = latestRun
        ? await this.db
            .select()
            .from(runStep)
            .where(eq(runStep.runId, latestRun.id))
            .orderBy(desc(runStep.startedAt))
            .limit(1)
        : [];
      return {
        ...summary,
        trust: null,
        why: summarizeProcessing(latestStep?.name ?? null),
      };
    }

    if (doc.status === 'failed') {
      return { ...summary, trust: null, why: summarizeFailed(latestRun?.error ?? null) };
    }

    // Queued. A run that already ended with an error, on a document back to
    // queued, is one the spending cap parked rather than one still waiting
    // for its first attempt.
    const parkedReason = latestRun?.endedAt ? (latestRun.error ?? null) : null;
    return { ...summary, trust: null, why: summarizeQueued(parkedReason) };
  }
}
