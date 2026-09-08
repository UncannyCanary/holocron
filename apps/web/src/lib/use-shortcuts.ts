import { useEffect, useEffectEvent } from 'react';

// The keys a screen answers to while nothing is being typed. A key is named
// in lower case, "enter" for the return key. A two key chord such as G then
// Q is written "g q". A handler gets the event so it can stop the browser
// doing its own thing with the key.
export type Shortcuts = Record<string, (event: KeyboardEvent) => void>;

// How long the first key of a chord waits for the second.
const CHORD_WINDOW_MS = 800;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

// Enter and Space on a focused button or link press that element. They are
// its keys, not the screen's, or one press would do two things at once.
function pressesTheElement(target: EventTarget | null, key: string): boolean {
  if (key !== 'enter' && key !== ' ') return false;
  return target instanceof HTMLElement && target.closest('button, a') !== null;
}

export function useShortcuts(shortcuts: Shortcuts): void {
  // Always the latest handlers, without taking the listener down and putting
  // it back every time the screen renders.
  const fire = useEffectEvent((chord: string | null, key: string, event: KeyboardEvent) => {
    const handler = (chord !== null && shortcuts[chord]) || shortcuts[key];
    handler?.(event);
  });

  useEffect(() => {
    let last: { key: string; at: number } | null = null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const key = event.key.toLowerCase();
      if (pressesTheElement(event.target, key)) return;
      const now = Date.now();
      const chord = last !== null && now - last.at < CHORD_WINDOW_MS ? `${last.key} ${key}` : null;
      last = { key, at: now };
      fire(chord, key, event);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
