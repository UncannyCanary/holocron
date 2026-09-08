import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { DocumentBadge, DocumentDot } from '../components/DocumentState';
import { Kbd } from '../components/Kbd';
import { type Hint, Screen } from '../components/Screen';
import { UploadDropzone } from '../components/UploadDropzone';
import type { DocumentSummary } from '../lib/api';
import { sortWorstFirst, stateOf, TYPE_LABELS, totalText } from '../lib/document-display';
import { DEFAULT_FILTERS } from '../lib/table-query';
import { useDocuments } from '../lib/use-documents';
import { useShortcuts } from '../lib/use-shortcuts';

export const Route = createFileRoute('/')({
  component: FirstVisitPage,
});

const HINTS: Hint[] = [
  { keys: ['⏎'], label: 'Open', dark: true },
  { keys: ['U'], label: 'Upload' },
  { keys: ['G', 'Q'], label: 'Queue' },
  { keys: ['G', 'T'], label: 'Table' },
  { keys: ['?'], label: 'All shortcuts' },
];

// The count is the one thing on the screen a person is looking for, so it
// sits in the verified green and the words stay in ink.
function Headline({ total, ready }: { total: number; ready: number }) {
  const count = (n: number) => <span className="text-verified-dot">{n}</span>;
  if (ready !== total) {
    return (
      <>
        {count(ready)} of {count(total)} documents are ready
      </>
    );
  }
  return total === 1 ? <>{count(1)} document is ready</> : <>{count(total)} documents are ready</>;
}

function FirstVisitPage() {
  const { data: documents = [], isPending } = useDocuments();
  const navigate = useNavigate();

  const sorted = sortWorstFirst(documents);
  const startHere = sorted.find((doc) => stateOf(doc) === 'needs-review');
  const rest = sorted.filter((doc) => doc !== startHere);
  const ready = documents.filter((doc) => doc.status === 'ready').length;

  useShortcuts({
    enter: () => {
      if (startHere) {
        navigate({ to: '/documents/$documentId', params: { documentId: startHere.id } });
      }
    },
    'g q': () => navigate({ to: '/queue' }),
    'g t': () => navigate({ to: '/table', search: DEFAULT_FILTERS }),
  });

  return (
    <Screen hints={HINTS}>
      <div className="flex flex-1 flex-col items-center px-5 pt-12">
        <div className="flex w-full max-w-[1040px] flex-col">
          {isPending ? (
            <p className="text-ink-soft">Loading your workspace…</p>
          ) : documents.length === 0 ? (
            <EmptyFirstVisit />
          ) : (
            <>
              <h1 className="font-serif text-display font-normal">
                <Headline total={documents.length} ready={ready} />
              </h1>
              <p className="mt-2.5 max-w-[720px] text-lede leading-relaxed text-ink-soft">
                {startHere
                  ? 'One of them has a problem worth your time. Add your own files whenever you like.'
                  : 'Everything here checks out so far. Add your own files whenever you like.'}
              </p>

              <div className="mt-8 grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_420px]">
                {startHere ? <StartHereCard doc={startHere} /> : <NothingToReview />}
                <UploadDropzone />
              </div>

              {rest.length > 0 && (
                <>
                  <div className="mt-9 mb-2 flex items-baseline justify-between">
                    <span className="caps">{startHere ? 'The rest' : 'Every document'}</span>
                    <Link
                      to="/queue"
                      className="inline-flex items-center gap-1.5 text-note no-underline"
                    >
                      See them in the queue<Kbd>G</Kbd>
                      <Kbd>Q</Kbd>
                    </Link>
                  </div>
                  <div className="flex flex-col">
                    {rest.map((doc) => (
                      <RestRow key={doc.id} doc={doc} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}

function StartHereCard({ doc }: { doc: DocumentSummary }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-lg border border-needs-review-line bg-card-raised px-[22px] py-5">
      <div className="flex items-center justify-between">
        <span className="caps">Start here</span>
        <DocumentBadge doc={doc} />
      </div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="font-serif text-[26px] leading-none">{doc.name}</span>
        <span className="font-mono text-note text-ink-soft">{TYPE_LABELS[doc.type]}</span>
      </div>
      <div className="text-sm leading-relaxed text-needs-review-ink">{doc.why}</div>
      <div className="mt-0.5 flex items-center gap-2.5">
        <Link
          to="/documents/$documentId"
          params={{ documentId: doc.id }}
          className="btn btn-primary"
        >
          Open this one<Kbd dark>⏎</Kbd>
        </Link>
        <span className="text-xs text-ink-quiet">
          {doc.date ?? '—'} · {totalText(doc)}
        </span>
      </div>
    </div>
  );
}

function NothingToReview() {
  return (
    <div className="flex flex-col justify-center gap-2 rounded-lg border border-line bg-card-raised px-[22px] py-5">
      <span className="caps">All clear</span>
      <div className="text-lede">Nothing needs your attention right now.</div>
      <div className="text-note text-ink-soft">Every document has been read and checked.</div>
    </div>
  );
}

function RestRow({ doc }: { doc: DocumentSummary }) {
  return (
    <Link
      to="/documents/$documentId"
      params={{ documentId: doc.id }}
      className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-1 py-[11px] text-ink no-underline hover:text-ink md:grid-cols-[14px_minmax(0,1fr)_96px_220px_132px]"
    >
      <DocumentDot doc={doc} />
      <span className="text-sm">{doc.name}</span>
      <span className="hidden text-note text-ink-soft md:block">{TYPE_LABELS[doc.type]}</span>
      <span
        className={`hidden text-note md:block ${doc.counterparty ? 'text-ink-soft' : 'text-ink-faint'}`}
      >
        {doc.counterparty ?? doc.why}
      </span>
      <span className="justify-self-end">
        <DocumentBadge doc={doc} />
      </span>
    </Link>
  );
}

function EmptyFirstVisit() {
  return (
    <div className="mt-10 flex flex-col gap-4">
      <h1 className="font-serif text-display font-normal">Nothing here yet</h1>
      <p className="max-w-[560px] text-lede text-ink-soft">Upload a document to get started.</p>
      <div className="max-w-[420px]">
        <UploadDropzone />
      </div>
    </div>
  );
}
