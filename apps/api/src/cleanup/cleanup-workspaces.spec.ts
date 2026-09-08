import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { document, page, workspace } from '../db/schema.js';
import { cleanupUntouchedWorkspaces } from './cleanup-workspaces.js';

async function backdateOpenedAt(
  db: ReturnType<typeof createDb>,
  workspaceId: string,
  days: number,
) {
  const openedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await db.update(workspace).set({ openedAt }).where(eq(workspace.id, workspaceId));
}

describe('cleanupUntouchedWorkspaces', () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron',
  );
  let tmp: string;

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    tmp = await mkdtemp(path.join(tmpdir(), 'holocron-cleanup-'));
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it('deletes a workspace untouched for 14 days, and its own upload with it', async () => {
    const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    await backdateOpenedAt(db, ws.id, 15);

    const filePath = path.join(tmp, `${randomUUID()}.pdf`);
    await writeFile(filePath, 'file contents');
    const [doc] = await db
      .insert(document)
      .values({ workspaceId: ws.id, type: 'invoice', status: 'ready', filePath })
      .returning();

    const imagePath = path.join(tmp, `${randomUUID()}.png`);
    await writeFile(imagePath, 'image contents');
    await db.insert(page).values({
      documentId: doc.id,
      number: 1,
      imagePath,
      widthPx: 100,
      heightPx: 100,
      widthPt: 100,
      heightPt: 100,
      textLayer: { source: 'pdf-text', spans: [] },
    });

    await cleanupUntouchedWorkspaces(db);

    const [remaining] = await db.select().from(workspace).where(eq(workspace.id, ws.id));
    expect(remaining).toBeUndefined();
    await expect(readFile(filePath)).rejects.toThrow();
    await expect(readFile(imagePath)).rejects.toThrow();
  });

  it('leaves a workspace opened recently alone', async () => {
    const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();

    await cleanupUntouchedWorkspaces(db);

    const [remaining] = await db.select().from(workspace).where(eq(workspace.id, ws.id));
    expect(remaining).toBeTruthy();
  });

  it('never deletes the file a sample copy shares with its canonical document', async () => {
    const canonicalPath = path.join(tmp, `${randomUUID()}.pdf`);
    await writeFile(canonicalPath, 'canonical contents');
    const [canonical] = await db
      .insert(document)
      .values({ type: 'invoice', status: 'ready', filePath: canonicalPath })
      .returning();

    const [ws] = await db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    await backdateOpenedAt(db, ws.id, 15);
    await db.insert(document).values({
      workspaceId: ws.id,
      documentId: canonical.id,
      type: 'invoice',
      status: 'ready',
      filePath: canonicalPath,
    });

    await cleanupUntouchedWorkspaces(db);

    await expect(readFile(canonicalPath)).resolves.toBeTruthy();
  });
});
