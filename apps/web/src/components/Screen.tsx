import type { ReactNode } from 'react';
import { Kbd } from './Kbd';
import { TopBar } from './TopBar';

// One keyboard hint along the bottom of a screen: the keys, then what they do.
export type Hint = { keys: string[]; label: string; dark?: boolean };

// The frame every screen shares: the top bar, the content, and the row of
// keyboard hints along the bottom.
export function Screen({
  breadcrumb,
  actions,
  hints,
  children,
}: {
  breadcrumb?: string;
  actions?: ReactNode;
  hints: Hint[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar breadcrumb={breadcrumb} actions={actions} />
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="flex h-10 items-center gap-5 border-t border-line bg-hint-bar px-5">
        {hints.map((hint) => (
          <span key={hint.label} className="hint">
            {hint.keys.map((key) => (
              <Kbd key={key} dark={hint.dark}>
                {key}
              </Kbd>
            ))}
            {hint.label}
          </span>
        ))}
      </footer>
    </div>
  );
}
