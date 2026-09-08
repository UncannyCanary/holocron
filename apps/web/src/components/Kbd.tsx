import type { ReactNode } from 'react';

// A key cap. Dark when it sits on a dark button.
export function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <span className={dark ? 'kbd kbd-dark' : 'kbd'}>{children}</span>;
}
