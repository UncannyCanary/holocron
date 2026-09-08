import type { DocumentType } from '@holocron/shared';

// Thrown for every non-2xx response, carrying the one plain sentence the API
// sent back so a screen can show it as it is.
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// The sentence to show for an error: the API's own when there is one, else
// the screen's fallback.
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? 'Something went wrong. Try again.');
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export type DoorStatus = { required: boolean; unlocked: boolean };

export function getDoorStatus(): Promise<DoorStatus> {
  return request('/door');
}

export function unlockDoor(code: string): Promise<{ unlocked: boolean }> {
  return request('/door', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export type Workspace = { id: string; createdAt: string };

// Returns the workspace this browser already has, or opens one and copies
// the samples into it. Called once, past the door.
export function ensureWorkspace(): Promise<Workspace> {
  return request('/workspace', { method: 'POST' });
}

export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type DocumentTrust = 'needs-review' | 'mostly-verified' | 'verified';

// One field's value and trust, as far as the data table needs it: no box,
// no quote, no page. The review screen has its own richer shape for that.
export type TableFieldValue = {
  name: string;
  value: string | null;
  currency: string | null;
  trust: FieldTrust;
};

export type DocumentSummary = {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  name: string;
  counterparty: string | null;
  date: string | null;
  total: { amount: string; currency: string | null } | null;
  trust: DocumentTrust | null;
  why: string;
  isSample: boolean;
  createdAt: string;
  fields: TableFieldValue[];
};

export function listDocuments(): Promise<DocumentSummary[]> {
  return request('/documents');
}

// The data table's own rows: the same summaries, but the search word is
// matched against every field value in Postgres rather than in the browser.
export function listTableDocuments(q: string): Promise<DocumentSummary[]> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request(`/documents/table${query}`);
}

export function uploadDocument(
  file: File,
  type: DocumentType,
): Promise<{ id: string; type: DocumentType; status: DocumentStatus }> {
  const body = new FormData();
  body.append('file', file);
  body.append('type', type);
  return request('/documents', { method: 'POST', body });
}

export type FieldTrust = 'verified' | 'unverifiable' | 'contradicted' | 'corrected';

// Where a value sits on its page, from 0 to 1, origin top left.
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type DocumentField = {
  id: string;
  // The path through the extraction schema: total, line_items.0.line_total.
  name: string;
  value: string | null;
  currency: string | null;
  trust: FieldTrust;
  quote: string | null;
  // Both null together. No box means the value was not found on the page.
  page: number | null;
  box: Box | null;
};

export type DocumentCheck = {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  // The fields the check works out, and the fields that fed it.
  blamedFieldIds: string[];
  flaggedFieldIds: string[];
};

export type DocumentPage = {
  number: number;
  widthPx: number;
  heightPx: number;
  imageUrl: string;
};

// One document with everything the review screen shows.
export type DocumentDetail = {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  fields: DocumentField[];
  checks: DocumentCheck[];
  pages: DocumentPage[];
  run: { startedAt: string; endedAt: string } | null;
};

export function getDocument(id: string): Promise<DocumentDetail> {
  return request(`/documents/${id}`);
}

// Saves a person's value over the model's. The API re-runs every check and
// says which ones turned around.
export function correctField(fieldId: string, value: string): Promise<{ changedChecks: string[] }> {
  return request(`/fields/${fieldId}/correction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

// Sends a failed document back to the queue and puts a fresh job in for it,
// rather than waiting for it to fail forever.
export function retryDocument(id: string): Promise<{ status: DocumentStatus }> {
  return request(`/documents/${id}/retry`, { method: 'POST' });
}

// Takes a document out of the workspace for good.
export function deleteDocument(id: string): Promise<void> {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

export type RunStep = {
  name: string;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
};

export type DocumentRun = {
  id: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  steps: RunStep[];
};

export function getDocumentTimeline(id: string): Promise<{ runs: DocumentRun[] }> {
  return request(`/documents/${id}/timeline`);
}

export type WorkspaceSettings = {
  createdAt: string;
  reopenSecret: string;
  uploads: { usedToday: number; perDay: number };
  spend: { usedThisMonthUsd: number; capUsd: number };
};

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return request('/workspace/settings');
}

export function reopenWorkspace(secret: string): Promise<Workspace> {
  return request('/workspace/reopen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
}
