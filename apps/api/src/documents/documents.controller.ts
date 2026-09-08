import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentType } from '@holocron/shared';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { workspaceIdFromCookieHeader } from '../cookie/workspace-cookie.js';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { check, document, field, page, run, runStep } from '../db/schema.js';
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

// A document in someone else's workspace reads the same as one that is not
// there at all.
const NO_SUCH_DOCUMENT = 'There is no such document.';
const NO_SUCH_PAGE = 'There is no such page.';

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The documents of one workspace. The list gives each one a name, a place in
// worst-first order, and one line saying why it sits there. The single
// document route gives the review screen everything else: every field with
// its box, every check, the pages, and the run that read it.
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

  // Everything the review screen shows about one document. The pages and the
  // run belong to the canonical row, since a sample's pages are read once and
  // shared; the fields and the checks are this workspace's own, since a
  // correction here must never touch another visitor's copy.
  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    const doc = await this.ownedDocument(req, id);
    const sharedId = doc.documentId ?? doc.id;

    const [fields, checks, pages, runs] = await Promise.all([
      this.db.select().from(field).where(eq(field.documentId, doc.id)).orderBy(field.createdAt),
      this.db.select().from(check).where(eq(check.documentId, doc.id)).orderBy(check.name),
      this.db.select().from(page).where(eq(page.documentId, sharedId)).orderBy(page.number),
      this.db
        .select()
        .from(run)
        .where(and(eq(run.documentId, sharedId), isNotNull(run.endedAt)))
        .orderBy(desc(run.endedAt))
        .limit(1),
    ]);

    const pageNumberById = new Map(pages.map((row) => [row.id, row.number]));
    const [latest] = runs;

    return {
      id: doc.id,
      type: doc.type as DocumentType,
      status: doc.status,
      fields: fields.map((row) => ({
        id: row.id,
        name: row.name,
        value: row.value,
        currency: row.currency,
        trust: row.trust,
        quote: row.quote,
        page: row.pageId === null ? null : (pageNumberById.get(row.pageId) ?? null),
        // All four corners or none: a field with no box was never found on the
        // page, and there is nothing to point at.
        box:
          row.x0 === null || row.y0 === null || row.x1 === null || row.y1 === null
            ? null
            : { x0: row.x0, y0: row.y0, x1: row.x1, y1: row.y1 },
      })),
      checks: checks.map((row) => ({
        id: row.id,
        name: row.name,
        passed: row.passed,
        message: row.message,
        blamedFieldIds: row.blamedFieldIds,
        flaggedFieldIds: row.flaggedFieldIds,
      })),
      pages: pages.map((row) => ({
        number: row.number,
        widthPx: row.widthPx,
        heightPx: row.heightPx,
        imageUrl: `/api/documents/${doc.id}/pages/${row.number}/image`,
      })),
      run: latest?.endedAt
        ? {
            startedAt: latest.startedAt.toISOString(),
            endedAt: latest.endedAt.toISOString(),
          }
        : null,
    };
  }

  // The picture of one page. The file sits on the data volume, which the
  // browser cannot reach, so it comes back through here and only for the
  // workspace that owns the document.
  @Get(':id/pages/:number/image')
  async pageImage(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('number') number: string,
    @Res() res: Response,
  ) {
    const doc = await this.ownedDocument(req, id);

    const wanted = Number(number);
    const [row] = Number.isInteger(wanted)
      ? await this.db
          .select()
          .from(page)
          .where(and(eq(page.documentId, doc.documentId ?? doc.id), eq(page.number, wanted)))
      : [];
    if (!row) {
      throw new HttpException(NO_SUCH_PAGE, HttpStatus.NOT_FOUND);
    }

    // The pages module writes every page image as a PNG.
    res.type('png').send(await readFile(row.imagePath));
  }

  // The document with this id, but only if this browser's workspace owns it.
  private async ownedDocument(req: Request, id: string): Promise<DocumentRow> {
    const workspaceId = workspaceIdFromCookieHeader(req.headers.cookie);
    if (workspaceId === null) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }

    // An id from a typed or edited address is not always a uuid, and asking
    // the database for one it cannot read is an error rather than an answer.
    const [doc] = IS_UUID.test(id)
      ? await this.db.select().from(document).where(eq(document.id, id))
      : [];
    if (!doc || doc.workspaceId !== workspaceId) {
      throw new HttpException(NO_SUCH_DOCUMENT, HttpStatus.NOT_FOUND);
    }
    return doc;
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
