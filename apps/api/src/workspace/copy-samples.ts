import { eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { check, document, field } from '../db/schema.js';

// The pages, the text layer, and the model run stay shared: this only copies
// the document, field, and check rows, so a correction in one workspace can
// never touch another visitor's copy of the same sample.
export async function copySampleDocumentsIntoWorkspace(db: Db, workspaceId: string): Promise<void> {
  const canonicalDocuments = await db.select().from(document).where(isNull(document.workspaceId));

  for (const canonical of canonicalDocuments) {
    const [copy] = await db
      .insert(document)
      .values({
        workspaceId,
        documentId: canonical.id,
        type: canonical.type,
        status: canonical.status,
        filePath: canonical.filePath,
      })
      .returning();

    const canonicalFields = await db.select().from(field).where(eq(field.documentId, canonical.id));
    const fieldIdMap = new Map<string, string>();

    for (const original of canonicalFields) {
      const [copiedField] = await db
        .insert(field)
        .values({
          documentId: copy.id,
          name: original.name,
          value: original.value,
          currency: original.currency,
          pageId: original.pageId,
          x0: original.x0,
          y0: original.y0,
          x1: original.x1,
          y1: original.y1,
          quote: original.quote,
          trust: original.trust,
        })
        .returning();
      fieldIdMap.set(original.id, copiedField.id);
    }

    const canonicalChecks = await db.select().from(check).where(eq(check.documentId, canonical.id));

    for (const original of canonicalChecks) {
      await db.insert(check).values({
        documentId: copy.id,
        name: original.name,
        passed: original.passed,
        message: original.message,
        blamedFieldIds: original.blamedFieldIds.map((id) => fieldIdMap.get(id) ?? id),
        flaggedFieldIds: original.flaggedFieldIds.map((id) => fieldIdMap.get(id) ?? id),
      });
    }
  }
}
