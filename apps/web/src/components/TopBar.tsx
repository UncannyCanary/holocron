import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DEFAULT_FILTERS } from '../lib/table-query';
import { Kbd } from './Kbd';
import { Logo } from './Logo';

// The bar every screen shares: the wordmark, a breadcrumb for where the
// screen sits, and whatever actions that screen needs on the right, before
// the Settings link and the shortcuts hint that are always there.
export function TopBar({ breadcrumb, actions }: { breadcrumb?: string; actions?: ReactNode }) {
  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b border-line px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
        <Link
          to="/"
          className="inline-flex flex-none items-center gap-2 font-serif text-[22px] leading-none text-ink no-underline"
        >
          <Logo />
          <span className="hidden sm:inline">Holocron</span>
        </Link>
        {breadcrumb && (
          <>
            <span className="text-crumb">/</span>
            <span className="truncate text-note text-ink-soft">{breadcrumb}</span>
          </>
        )}
      </div>
      <div className="flex flex-none items-center gap-2.5 sm:gap-3.5">
        {actions}
        <nav className="flex items-center gap-2.5 text-note sm:gap-3.5">
          <Link to="/queue" className="no-underline" activeProps={{ className: 'text-ink' }}>
            Queue
          </Link>
          <Link
            to="/table"
            search={DEFAULT_FILTERS}
            className="no-underline"
            activeProps={{ className: 'text-ink' }}
          >
            Table
          </Link>
          <Link to="/settings" className="no-underline" activeProps={{ className: 'text-ink' }}>
            Settings
          </Link>
        </nav>
        <span className="hint hidden sm:inline-flex">
          <Kbd>?</Kbd>Shortcuts
        </span>
      </div>
    </header>
  );
}
