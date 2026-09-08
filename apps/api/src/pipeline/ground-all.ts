import type { Box, PageTextLayer } from '@holocron/shared';
import { type Grounding, ground } from '../ground/ground.js';
import type { FlatField } from './flatten.js';

type Page = { number: number; textLayer: PageTextLayer };

// The list row a field belongs to, such as line_items.1, or null for a value
// that stands on its own.
function rowOf(name: string): string | null {
  const found = /^(.+\.\d+)\.[^.]+$/.exec(name);
  return found === null ? null : found[1];
}

function sameBox(left: Box, right: Box): boolean {
  return (
    left.x0 === right.x0 && left.y0 === right.y0 && left.x1 === right.x1 && left.y1 === right.y1
  );
}

// Finds every value on its pages, in two passes. The first takes each value
// on its own. The second goes back over them in order with what is known so
// far: the words another value already owns are not this one's, and among a
// row's values the match on the same line, nearest to the rest of the row,
// wins. A short quote such as "3" can be on the page several times, and this
// is how the right one is picked.
//
// When two values landed on the very same words in the first pass, such as a
// unit price and a line total that are both 2400.00, the earlier one keeps
// them and only the later one moves on to the next place the words appear.
export function groundAll(flats: FlatField[], pages: Page[]): Map<string, Grounding | null> {
  const found = new Map<string, Grounding | null>();
  for (const flat of flats) {
    const { value, quote, page } = flat;
    found.set(flat.name, value === null ? null : ground({ value, quote, page }, pages));
  }

  flats.forEach((flat, index) => {
    const { value, quote, page } = flat;
    if (value === null || page === null) return;
    const own = found.get(flat.name);
    const row = rowOf(flat.name);

    const others: Array<{ name: string; box: Box }> = [];
    flats.forEach((each, otherIndex) => {
      const other = found.get(each.name);
      if (each.name === flat.name || other == null || other.page !== page) return;
      // A later value on the same words is the one that will move, not this.
      if (otherIndex > index && own != null && sameBox(other.box, own.box)) return;
      others.push({ name: each.name, box: other.box });
    });

    found.set(
      flat.name,
      ground(
        {
          value,
          quote,
          page,
          avoid: others.map((each) => each.box),
          near:
            row === null
              ? []
              : others.filter((each) => rowOf(each.name) === row).map((each) => each.box),
        },
        pages,
      ),
    );
  });

  return found;
}
