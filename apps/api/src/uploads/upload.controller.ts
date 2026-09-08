import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type DocumentType, extractionSchemas, LIMITS, MESSAGES } from '@holocron/shared';
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  PayloadTooLargeException,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { workspaceIdFromCookieHeader } from '../cookie/workspace-cookie.js';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { document, run, runStep } from '../db/schema.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { JobsService } from '../jobs/jobs.module.js';
import { dataPath } from '../paths.js';
import { NO_WORKSPACE_MESSAGE } from '../workspace/workspace.controller.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { WorkspaceService } from '../workspace/workspace.service.js';
import {
  checkDailyUploadQuota,
  checkFileSize,
  checkFileType,
  checkFreeSpaceOn,
} from './upload-limits.js';

// What multer hands us. Only these four parts are used.
type UploadedFileLike = {
  originalname: string;
  buffer: Buffer;
  size: number;
};

const CHOOSE_A_FILE = 'Choose a file to upload.';
const CHOOSE_A_TYPE = 'Say whether this is an invoice, a receipt, or a contract.';

// A file bigger than multer will hold never reaches the route, so the plain
// sentence is put back on here. Both ways of being too big say the same thing.
@Injectable()
@Catch(PayloadTooLargeException)
class FileTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: MESSAGES.fileTooLarge,
    });
  }
}

// Keeps the name the person gave the file, without letting it point anywhere
// but the folder we made for it.
function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]/g, '_');
  return base === '' || base.startsWith('.') ? `upload${path.extname(base)}` : base;
}

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && value in extractionSchemas;
}

@Controller('documents')
export class UploadController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly workspaces: WorkspaceService,
  ) {}

  // Saves the file, writes the document and run rows, and puts the job on the
  // queue, all in one transaction. A document row without its job would sit
  // queued forever; a job without its row would fail every time it was tried.
  @Post()
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(
    // One byte over our own limit, so the check below is what a person sees
    // for an ordinary oversized file and this only stops the runaway ones.
    FileInterceptor('file', { limits: { fileSize: LIMITS.maxFileSizeBytes + 1 } }),
  )
  async upload(
    @Req() req: Request,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body('type') type: unknown,
  ) {
    const workspaceId = workspaceIdFromCookieHeader(req.headers.cookie);
    const workspace = workspaceId === null ? null : await this.workspaces.find(workspaceId);
    if (workspace === null) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }
    if (!file) {
      throw new HttpException(CHOOSE_A_FILE, HttpStatus.BAD_REQUEST);
    }
    if (!isDocumentType(type)) {
      throw new HttpException(CHOOSE_A_TYPE, HttpStatus.BAD_REQUEST);
    }

    const size = checkFileSize(file.size);
    if (!size.ok) {
      throw new HttpException(size.message, HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const kind = checkFileType(file.buffer);
    if (!kind.ok) {
      throw new HttpException(kind.message, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const quota = await checkDailyUploadQuota(this.db, workspace.id);
    if (!quota.ok) {
      throw new HttpException(quota.message, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Asked of the disk itself, right before anything is written to it.
    const uploads = dataPath('uploads');
    await mkdir(uploads, { recursive: true });
    const room = await checkFreeSpaceOn(uploads);
    if (!room.ok) {
      throw new HttpException(room.message, HttpStatus.INSUFFICIENT_STORAGE);
    }

    const documentId = randomUUID();
    const filePath = path.join(uploads, documentId, safeName(file.originalname));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.buffer);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(document)
        .values({ id: documentId, workspaceId: workspace.id, type, status: 'queued', filePath });

      const [attempt] = await tx.insert(run).values({ documentId }).returning();
      const now = new Date();
      await tx
        .insert(runStep)
        .values({ runId: attempt.id, name: 'received', startedAt: now, endedAt: now });

      await this.jobs.sendProcessDocument({ documentId, workspaceId: workspace.id }, tx);
    });

    await this.workspaces.touch(workspace.id);

    return { id: documentId, type, status: 'queued' };
  }
}
