import type { Span } from '@holocron/shared';

// PDF text can carry control characters, such as a NUL where a font had no
// glyph. They mean nothing to a reader, they cannot be stored in JSON in
// Postgres, and they would never match a quote. They go, and a word with
// nothing left goes with them. Tabs and line breaks stay.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(text: string): string {
  return text.replace(CONTROL, '');
}

export function cleanSpans(spans: Span[]): Span[] {
  return spans
    .map((span) => ({ ...span, text: cleanText(span.text) }))
    .filter((span) => span.text.trim().length > 0);
}
