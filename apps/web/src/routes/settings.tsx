import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { type Hint, Screen } from '../components/Screen';
import { messageOf } from '../lib/api';
import { useShortcuts } from '../lib/use-shortcuts';
import { useWorkspaceSettings } from '../lib/use-workspace-settings';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const HINTS: Hint[] = [
  { keys: ['G', 'Q'], label: 'Queue' },
  { keys: ['?'], label: 'All shortcuts' },
];

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function SettingsPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useWorkspaceSettings();

  useShortcuts({
    'g q': () => navigate({ to: '/queue' }),
  });

  return (
    <Screen breadcrumb="Settings" hints={HINTS}>
      <div className="flex flex-1 justify-center px-5 pt-12">
        <div className="flex w-full max-w-[640px] flex-col gap-8">
          <h1 className="font-serif text-title font-normal">Settings</h1>

          {isPending && <p className="text-note text-ink-soft">Loading…</p>}
          {isError && (
            <p className="text-note text-needs-review">
              {messageOf(error, 'Could not load your workspace settings.')}
            </p>
          )}

          {data && (
            <>
              <Section title="This workspace">
                <Row label="Started">
                  {new Date(data.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Row>
                <div className="flex flex-col gap-1.5 border-line-row border-t px-2 py-3">
                  <span className="text-note text-ink-soft">
                    Open your workspace on another browser or device with this link. Anyone who has
                    it can see and change everything in it, the same as you can.
                  </span>
                  <ReopenLink url={`${window.location.origin}/reopen/${data.reopenSecret}`} />
                </div>
              </Section>

              <Section title="Uploads today">
                <Row label="Used">
                  {data.uploads.usedToday} of {data.uploads.perDay}
                </Row>
              </Section>

              <Section title="Model spend this month">
                <Row label="Used">
                  {money(data.spend.usedThisMonthUsd)} of {money(data.spend.capUsd)}
                </Row>
              </Section>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-line bg-panel">
      <div className="caps px-5 pt-4 pb-2">{title}</div>
      <div className="flex flex-col px-3 pb-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-line-row border-t px-2 py-3 first:border-t-0">
      <span className="text-note text-ink-soft">{label}</span>
      <span className="font-mono text-note text-ink">{children}</span>
    </div>
  );
}

function ReopenLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing more to do. The link is still selectable in the box below.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        readOnly
        value={url}
        aria-label="Your reopen link"
        onFocus={(event) => event.target.select()}
        className="h-8 flex-1 rounded border border-line-strong bg-card-raised px-2.5 font-mono text-xs text-ink"
      />
      <button type="button" className="btn" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
