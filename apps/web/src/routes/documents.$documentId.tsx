import { createFileRoute, Link } from '@tanstack/react-router';
import { DocumentBadge } from '../components/DocumentState';
import { Screen } from '../components/Screen';
import { TYPE_LABELS, totalText } from '../lib/document-display';
import { useDocuments } from '../lib/use-documents';

export const Route = createFileRoute('/documents/$documentId')({
  component: ReviewPlaceholder,
});

// The review screen itself is built next: page image, boxes, corrections.
// This route exists now so a row in the queue and on the first visit has
// somewhere real to land.
function ReviewPlaceholder() {
  const { documentId } = Route.useParams();
  const { data: documents, isPending } = useDocuments();
  const doc = documents?.find((each) => each.id === documentId);

  return (
    <Screen breadcrumb={doc?.name ?? 'Document'} hints={[{ keys: ['?'], label: 'All shortcuts' }]}>
      <div className="flex flex-1 flex-col items-center px-5 py-12">
        <div className="flex w-full max-w-[640px] flex-col gap-4">
          <Link to="/queue" className="text-note">
            ← Back to the queue
          </Link>

          {isPending ? (
            <p className="text-ink-soft">Loading…</p>
          ) : !doc ? (
            <p className="text-ink-soft">There is no such document in this workspace.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h1 className="font-serif text-[32px] font-normal">{doc.name}</h1>
                <span className="font-mono text-note text-ink-soft">{TYPE_LABELS[doc.type]}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <DocumentBadge doc={doc} />
                <span className="text-note text-ink-soft">
                  {doc.date ?? '—'} · {totalText(doc)}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink-soft">{doc.why}</p>
              <p className="text-note text-ink-quiet">
                The full review screen, with the page and every field, is not built yet.
              </p>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
