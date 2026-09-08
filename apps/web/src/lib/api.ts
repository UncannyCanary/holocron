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
};

export function listDocuments(): Promise<DocumentSummary[]> {
  return request('/documents');
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
