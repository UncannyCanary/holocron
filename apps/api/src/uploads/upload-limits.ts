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
