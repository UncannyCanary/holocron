import type { PageTextLayer } from '@holocron/shared';

// Turns a page's words back into lines of text. The model reads this text
// next to the page image, and grounding later looks for the model's quote in
// the very same words, so the two can never drift apart.
//
// Words arrive in reading order with a box each. A word starts a new line
// when its middle sits more than half a line's height away from the middle of
// the line being built.
export function textLayerToText(layer: PageTextLayer): string {
  const lines: string[][] = [];
  let lineMiddle: number | null = null;
  let lineHeight = 0;

  for (const span of layer.spans) {
    const middle = (span.box.y0 + span.box.y1) / 2;
    const height = span.box.y1 - span.box.y0;
    const gap = Math.max(lineHeight, height) / 2;

    if (lineMiddle !== null && Math.abs(middle - lineMiddle) <= gap) {
      lines[lines.length - 1].push(span.text);
      continue;
    }

    lines.push([span.text]);
    lineMiddle = middle;
    lineHeight = height;
  }

  return lines.map((words) => words.join(' ')).join('\n');
}
