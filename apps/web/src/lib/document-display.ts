import type { DocumentType } from '@holocron/shared';
import type { DocumentSummary } from './api';

export const TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  contract: 'Contract',
};

// The one state a document shows on screen. A ready document shows its
// trust; anything else shows how far along it is.
export type DocumentState =
  | 'needs-review'
  | 'mostly-verified'
  | 'verified'
  | 'working'
  | 'queued'
  | 'failed';

type Stateful = Pick<DocumentSummary, 'status' | 'trust'>;

export function stateOf(doc: Stateful): DocumentState {
  if (doc.status === 'ready') return doc.trust ?? 'verified';
  if (doc.status === 'processing') return 'working';
  return doc.status;
}

export const STATE_LABELS: Record<DocumentState, string> = {
  'needs-review': 'Needs review',
  'mostly-verified': 'Mostly verified',
  verified: 'Verified',
  working: 'Working',
  queued: 'Queued',
  failed: 'Failed',
};

// Worst first: a document that failed or is still being read needs a look
// before one that only turned out mostly verified, which needs a look before
// one that is fully verified.
const RANK: Record<DocumentState, number> = {
  failed: 0,
  working: 1,
  queued: 2,
  'needs-review': 3,
  'mostly-verified': 4,
  verified: 5,
};

export function sortWorstFirst(docs: DocumentSummary[]): DocumentSummary[] {
  return [...docs].sort(
    (left, right) =>
      RANK[stateOf(left)] - RANK[stateOf(right)] || left.createdAt.localeCompare(right.createdAt),
  );
}

export function totalText(doc: Pick<DocumentSummary, 'total'>): string {
  if (!doc.total) return '—';
  return doc.total.currency ? `${doc.total.amount} ${doc.total.currency}` : doc.total.amount;
}
