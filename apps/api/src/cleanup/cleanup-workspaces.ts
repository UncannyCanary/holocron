import { unlink } from 'node:fs/promises';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { untouchedWorkspacesQuery } from '../db/queries.js';
import { document, page, workspace } from '../db/schema.js';

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Already gone, or never existed. Either way there is nothing left to do.
  }
}

// Workspaces nobody has opened in 14 days, deleted along with the files they
// own. A sample's file and page images are shared across every workspace, so
// only a workspace's own uploads (documentId null) are ever removed from
// disk; the row deletes cascade the rest.
export async function cleanupUntouchedWorkspaces(db: Db): Promise<{ deletedWorkspaces: number }> {
  const untouched = await untouchedWorkspacesQuery(db);

  for (const ws of untouched) {
    const ownDocuments = await db
      .select({ id: document.id, filePath: document.filePath })
      .from(document)
      .where(and(eq(document.workspaceId, ws.id), isNull(document.documentId)));

    for (const doc of ownDocuments) {
      const pages = await db
        .select({ imagePath: page.imagePath })
        .from(page)
        .where(eq(page.documentId, doc.id));
      for (const p of pages) {
        await removeIfExists(p.imagePath);
      }
      await removeIfExists(doc.filePath);
    }

    await db.delete(workspace).where(eq(workspace.id, ws.id));
  }

  return { deletedWorkspaces: untouched.length };
}
