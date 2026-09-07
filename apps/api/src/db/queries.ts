import { lt, sql } from 'drizzle-orm';
import type { createDb } from './client.js';
import { workspace } from './schema.js';

// Workspaces nobody has opened in 14 days. A nightly job deletes these
// rows; the cascade on document.workspaceId takes their documents,
// fields, checks, and corrections with them.
export function untouchedWorkspacesQuery(db: ReturnType<typeof createDb>) {
  return db
    .select({ id: workspace.id })
    .from(workspace)
    .where(lt(workspace.openedAt, sql`now() - interval '14 days'`));
}
