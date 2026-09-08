import type { DocumentSummary } from '../lib/api';
import { STATE_LABELS, stateOf } from '../lib/document-display';

type Stateful = Pick<DocumentSummary, 'status' | 'trust'>;

export function DocumentBadge({ doc }: { doc: Stateful }) {
  const state = stateOf(doc);
  return <span className={`badge badge-${state}`}>{STATE_LABELS[state]}</span>;
}

// A small clock stands in for the dot while a document is still being read,
// since there is no trust colour for "we do not know yet".
export function DocumentDot({ doc }: { doc: Stateful }) {
  const state = stateOf(doc);
  if (state === 'working') {
    return (
      <svg
        className="size-3.5 text-ink-quiet"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
    );
  }
  return <span className={`dot dot-${state}`} />;
}
