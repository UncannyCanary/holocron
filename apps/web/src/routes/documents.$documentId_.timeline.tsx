import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { type Hint, Screen } from '../components/Screen';
import type { DocumentRun, RunStep } from '../lib/api';
import { messageOf } from '../lib/api';
import { STEP_LABELS } from '../lib/document-display';
import { agoText, durationText } from '../lib/relative-time';
import { useDocument } from '../lib/use-document';
import { useShortcuts } from '../lib/use-shortcuts';
import { useDocumentTimeline } from '../lib/use-timeline';

export const Route = createFileRoute('/documents/$documentId_/timeline')({
  component: TimelineRoute,
});

const HINTS: Hint[] = [{ keys: ['G', 'Q'], label: 'Queue' }];

function TimelineRoute() {
  const { documentId } = Route.useParams();
  const navigate = useNavigate();
  const { data: doc } = useDocument(documentId);
  const { data, isPending, isError, error } = useDocumentTimeline(documentId);

  useShortcuts({
    'g q': () => navigate({ to: '/queue' }),
  });

  return (
    <Screen
      breadcrumb="Timeline"
      hints={HINTS}
      actions={
        <Link
          to="/documents/$documentId"
          params={{ documentId }}
          className="text-note no-underline"
        >
          Back to the review screen
        </Link>
      }
    >
      <div className="flex flex-1 justify-center px-5 pt-12">
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <h1 className="font-serif text-title font-normal">
            {doc ? 'Every run this document has had' : 'Timeline'}
          </h1>

          {isPending && <p className="text-note text-ink-soft">Loading…</p>}
          {isError && (
            <p className="text-note text-needs-review">
              {messageOf(error, 'Could not load the timeline.')}
            </p>
          )}
          {data && data.runs.length === 0 && (
            <p className="text-note text-ink-soft">This document has no run to show.</p>
          )}

          {data?.runs.map((run, index) => (
            <RunCard key={run.id} run={run} place={data.runs.length - index} />
          ))}
        </div>
      </div>
    </Screen>
  );
}

function RunCard({ run, place }: { run: DocumentRun; place: number }) {
  const started = new Date(run.startedAt);
  const ended = run.endedAt ? new Date(run.endedAt) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lede">Run {place}</span>
        <span className="text-xs text-ink-quiet">
          Started {agoText(started, new Date())}
          {ended && ` · took ${durationText(ended.getTime() - started.getTime())}`}
          {!ended && ' · still going'}
        </span>
      </div>

      {run.model && <div className="text-note text-ink-soft">Read by {run.model}.</div>}

      {run.error && (
        <div className="rounded-md border border-needs-review-line bg-needs-review-bg/60 px-3 py-2.5 text-note text-needs-review-ink">
          {run.error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {run.steps.map((step) => (
          <StepRow key={step.name} step={step} />
        ))}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: RunStep }) {
  const label = STEP_LABELS[step.name] ?? step.name;
  const state = step.error !== null ? 'failed' : step.endedAt !== null ? 'verified' : 'working';
  const duration =
    step.startedAt && step.endedAt
      ? durationText(new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime())
      : null;

  return (
    <div className="flex items-start gap-2.5 text-note">
      <span className={`dot mt-1.5 dot-${state}`} />
      <span className="flex-1">
        <span className={step.error !== null ? 'text-needs-review' : ''}>{label}</span>
        {duration && <span className="ml-2 text-xs text-ink-quiet">{duration}</span>}
        {step.error !== null && (
          <div className="mt-0.5 text-xs text-needs-review-ink">{step.error}</div>
        )}
      </span>
    </div>
  );
}
