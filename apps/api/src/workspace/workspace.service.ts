import { randomUUID } from 'node:crypto';
import { LIMITS, MESSAGES } from '@holocron/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { type Workspace, workspace } from '../db/schema.js';
import { copySampleDocumentsIntoWorkspace } from './copy-samples.js';

const CREATION_WINDOW_MS = 60 * 60_000;

export type CreationCheck = { ok: true } | { ok: false; message: string };

@Injectable()
export class WorkspaceService {
  private readonly creations = new Map<string, { count: number; windowStart: number }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async find(workspaceId: string): Promise<Workspace | null> {
    const [row] = await this.db.select().from(workspace).where(eq(workspace.id, workspaceId));
    return row ?? null;
  }

  // The workspace a reopen link points at, so it can be opened again on
  // another browser. Also counts as a visit, the same as passing the door.
  async findByReopenSecret(secret: string): Promise<Workspace | null> {
    const [row] = await this.db.select().from(workspace).where(eq(workspace.reopenSecret, secret));
    if (row) {
      await this.touch(row.id);
    }
    return row ?? null;
  }

  async touch(workspaceId: string): Promise<void> {
    await this.db
      .update(workspace)
      .set({ openedAt: new Date() })
      .where(eq(workspace.id, workspaceId));
  }

  // 3 new workspaces an hour per IP. One visitor opening several tabs still
  // shares one workspace via the cookie, so this only ever limits a script
  // creating fresh ones with no cookie at all.
  checkCreationRate(ip: string): CreationCheck {
    const now = Date.now();
    const record = this.creations.get(ip);

    if (!record || now - record.windowStart >= CREATION_WINDOW_MS) {
      this.creations.set(ip, { count: 1, windowStart: now });
      return { ok: true };
    }

    if (record.count >= LIMITS.workspacesPerIpPerHour) {
      return { ok: false, message: MESSAGES.tooManyWorkspaces };
    }

    record.count += 1;
    return { ok: true };
  }

  async create(): Promise<Workspace> {
    const [ws] = await this.db.insert(workspace).values({ reopenSecret: randomUUID() }).returning();
    await copySampleDocumentsIntoWorkspace(this.db, ws.id);
    return ws;
  }
}
