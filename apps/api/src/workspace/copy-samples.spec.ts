import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { check, document, field, workspace } from '../db/schema.js';
import { copySampleDocumentsIntoWorkspace } from './copy-samples.js';

describe('copySampleDocumentsIntoWorkspace', () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron',
  );

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('gives the workspace its own copy of a canonical document, its fields, and its checks', async () => {
    const [canonical] = await db
      .insert(document)
      .values({ type: 'invoice', status: 'ready', filePath: `/data/canonical-${randomUUID()}.pdf` })
      .returning();

    const [total] = await db
      .insert(field)
      .values({
        documentId: canonical.id,
        name: 'total',
        value: '100.00',
        quote: '100.00',
        trust: 'verified',
      })
      .returning();

    await db.insert(check).values({
      documentId: canonical.id,
      name: 'total_matches_subtotal',
      passed: true,
      message: 'The total matches the subtotal.',
      blamedFieldIds: [],
      flaggedFieldIds: [total.id],
    });

    const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    await copySampleDocumentsIntoWorkspace(db, ws.id);

    // Filtered by documentId, not just workspaceId, since a real database
    // holds every other canonical sample too and this only cares about the
    // copy of the one made for this test.
    const [copy] = await db
      .select()
      .from(document)
      .where(and(eq(document.workspaceId, ws.id), eq(document.documentId, canonical.id)));
    expect(copy).toBeTruthy();
    expect(copy.documentId).toBe(canonical.id);
    expect(copy.filePath).toBe(canonical.filePath);

    const copiedFields = await db.select().from(field).where(eq(field.documentId, copy.id));
    expect(copiedFields).toHaveLength(1);
    expect(copiedFields[0].id).not.toBe(total.id);
    expect(copiedFields[0].value).toBe('100.00');

    const copiedChecks = await db.select().from(check).where(eq(check.documentId, copy.id));
    expect(copiedChecks).toHaveLength(1);
    // The check must point at the copy's own field row, not the canonical one.
    expect(copiedChecks[0].flaggedFieldIds).toEqual([copiedFields[0].id]);
  });

  it('correcting a copy never touches the canonical field or another workspace copy', async () => {
    const [canonical] = await db
      .insert(document)
      .values({ type: 'invoice', status: 'ready', filePath: `/data/canonical-${randomUUID()}.pdf` })
      .returning();
    await db.insert(field).values({
      documentId: canonical.id,
      name: 'total',
      value: '100.00',
      quote: '100.00',
      trust: 'verified',
    });

    const [wsA] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    const [wsB] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    await copySampleDocumentsIntoWorkspace(db, wsA.id);
    await copySampleDocumentsIntoWorkspace(db, wsB.id);

    const [copyA] = await db
      .select()
      .from(document)
      .where(and(eq(document.workspaceId, wsA.id), eq(document.documentId, canonical.id)));
    const [fieldA] = await db.select().from(field).where(eq(field.documentId, copyA.id));

    await db
      .update(field)
      .set({ value: '110.00', trust: 'corrected' })
      .where(eq(field.id, fieldA.id));

    const [canonicalField] = await db
      .select()
      .from(field)
      .where(eq(field.documentId, canonical.id));
    const [copyB] = await db
      .select()
      .from(document)
      .where(and(eq(document.workspaceId, wsB.id), eq(document.documentId, canonical.id)));
    const [fieldB] = await db.select().from(field).where(eq(field.documentId, copyB.id));

    expect(canonicalField.value).toBe('100.00');
    expect(fieldB.value).toBe('100.00');
  });
});
