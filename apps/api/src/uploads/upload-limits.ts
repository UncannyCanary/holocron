import { statfs } from 'node:fs/promises';
import { LIMITS, MESSAGES } from '@holocron/shared';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { document } from '../db/schema.js';

export type LimitCheck = { ok: true } | { ok: false; message: string };

// 10 MB per file, checked before anything is read off disk.
export function checkFileSize(bytes: number): LimitCheck {
  if (bytes > LIMITS.maxFileSizeBytes) {
    return { ok: false, message: MESSAGES.fileTooLarge };
  }
  return { ok: true };
}

// At least 2 GB left on the data volume. Postgres keeps its tables on the
// same disk, so filling it up would stop the whole site, not just uploads.
export function checkFreeSpace(freeBytes: number): LimitCheck {
  if (freeBytes < LIMITS.minFreeSpaceBytes) {
    return { ok: false, message: MESSAGES.outOfRoom };
  }
  return { ok: true };
}

// The same check, asking the disk itself. The folder has to exist already.
// bavail is the room an ordinary user may have, which is what we can use.
export async function checkFreeSpaceOn(dir: string): Promise<LimitCheck> {
  const disk = await statfs(dir);
  return checkFreeSpace(disk.bavail * disk.bsize);
}

// The first bytes of the three kinds of file we take. The name and the
// declared type are what the sender says; the bytes are what the file is.
const SIGNATURES = [
  Buffer.from('%PDF-'),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0xff, 0xd8, 0xff]),
];

// Only PDF, PNG, and JPEG, decided from the first bytes of the file.
export function checkFileType(bytes: Buffer): LimitCheck {
  const known = SIGNATURES.some(
    (signature) =>
      bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature),
  );
  return known ? { ok: true } : { ok: false, message: MESSAGES.wrongFileType };
}

// 20 pages per document, checked once the page count is known.
export function checkPageCount(pages: number): LimitCheck {
  if (pages > LIMITS.maxPagesPerDocument) {
    return { ok: false, message: MESSAGES.tooManyPages };
  }
  return { ok: true };
}

// How many files this workspace has uploaded itself in the last 24 hours.
// Counts real uploads only: a workspace's own documents, not the sample
// copies it was given, which point back at a canonical document instead.
export async function uploadsToday(db: Db, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(document)
    .where(
      and(
        eq(document.workspaceId, workspaceId),
        isNull(document.documentId),
        // A document split out of an uploaded file was not a second upload.
        isNull(document.sourceId),
        gte(document.createdAt, sql`now() - interval '24 hours'`),
      ),
    );

  return row?.count ?? 0;
}

// 10 uploads a day per workspace.
export async function checkDailyUploadQuota(db: Db, workspaceId: string): Promise<LimitCheck> {
  const used = await uploadsToday(db, workspaceId);
  if (used >= LIMITS.uploadsPerWorkspacePerDay) {
    return { ok: false, message: MESSAGES.tooManyUploadsToday };
  }
  return { ok: true };
}
