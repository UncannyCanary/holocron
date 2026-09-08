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

// 20 pages per document, checked once the page count is known.
export function checkPageCount(pages: number): LimitCheck {
  if (pages > LIMITS.maxPagesPerDocument) {
    return { ok: false, message: MESSAGES.tooManyPages };
  }
  return { ok: true };
}

// 10 uploads a day per workspace. Counts real uploads only: a workspace's own
// documents, not the sample copies it was given, which point back at a
// canonical document instead.
export async function checkDailyUploadQuota(db: Db, workspaceId: string): Promise<LimitCheck> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(document)
    .where(
      and(
        eq(document.workspaceId, workspaceId),
        isNull(document.documentId),
        gte(document.createdAt, sql`now() - interval '24 hours'`),
      ),
    );

  if ((row?.count ?? 0) >= LIMITS.uploadsPerWorkspacePerDay) {
    return { ok: false, message: MESSAGES.tooManyUploadsToday };
  }
  return { ok: true };
}
