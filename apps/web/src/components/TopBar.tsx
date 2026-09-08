import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

// The bar every screen shares: the wordmark, a breadcrumb for where the
// screen sits, and whatever actions that screen needs on the right, before
// the Settings link and the shortcuts hint that are always there.
export function TopBar({ breadcrumb, actions }: { breadcrumb?: string; actions?: ReactNode }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-line px-5">
      <div className="flex items-center gap-2.5">
        <Link to="/" className="font-serif text-[22px] leading-none text-ink no-underline">
          Holocron
        </Link>
        {breadcrumb && (
          <>
            <span className="text-crumb">/</span>
            <span className="text-note text-ink-soft">{breadcrumb}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3.5">
        {actions}
        <Link to="/settings" className="text-note">
          Settings
        </Link>
        <span className="hint">
          <Kbd>?</Kbd>Shortcuts
        </span>
      </div>
    </header>
  );
}
