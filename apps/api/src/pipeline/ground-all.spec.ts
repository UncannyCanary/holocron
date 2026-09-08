import type { Span } from '@holocron/shared';
import { describe, expect, it } from 'vitest';
import type { FlatField } from './flatten.js';
import { groundAll } from './ground-all.js';

// One line of words across the page, each with a box, the way the text layer
// holds them. Row 0 is the top line.
function line(row: number, text: string): Span[] {
  const spans: Span[] = [];
  let left = 0.08;
  for (const word of text.split(' ')) {
    const width = 0.014 * word.length;
    spans.push({
      text: word,
      box: { x0: left, y0: 0.05 + row * 0.06, x1: left + width, y1: 0.07 + row * 0.06 },
      confidence: null,
    });
    left += width + 0.012;
  }
  return spans;
}

function flat(name: string, value: string, quote = value): FlatField {
  return { name, value, currency: null, page: 1, quote };
}

describe('groundAll', () => {
  it('gives a quantity the 3 in its own column, not the 3 inside the description', () => {
    const words = line(0, 'Packaging design, 3 SKUs 3 350.00 1050.00');
    const pages = [{ number: 1, textLayer: { source: 'pdf-text' as const, spans: words } }];

    const found = groundAll(
      [
        flat('line_items.0.description', 'Packaging design, 3 SKUs'),
        flat('line_items.0.quantity', '3'),
        flat('line_items.0.unit_price', '350', '350.00'),
        flat('line_items.0.line_total', '1050', '1050.00'),
      ],
      pages,
    );

    expect(found.get('line_items.0.quantity')?.box).toEqual(words[4].box);
    expect(found.get('line_items.0.description')?.box.x0).toBe(words[0].box.x0);
  });

  it('gives a unit price and a line total that read the same each their own column', () => {
    const words = line(0, 'Brand identity package 1 2400.00 2400.00');
    const pages = [{ number: 1, textLayer: { source: 'pdf-text' as const, spans: words } }];

    const found = groundAll(
      [
        flat('line_items.0.description', 'Brand identity package'),
        flat('line_items.0.quantity', '1'),
        flat('line_items.0.unit_price', '2400', '2400.00'),
        flat('line_items.0.line_total', '2400', '2400.00'),
      ],
      pages,
    );

    expect(found.get('line_items.0.unit_price')?.box).toEqual(words[4].box);
    expect(found.get('line_items.0.line_total')?.box).toEqual(words[5].box);
  });

  it('lets two values share the one place their words appear', () => {
    const words = line(0, 'Total 91000 CASH');
    const pages = [{ number: 1, textLayer: { source: 'pdf-text' as const, spans: words } }];

    const found = groundAll([flat('total', '91000'), flat('cash', '91000')], pages);

    expect(found.get('total')?.box).toEqual(words[1].box);
    expect(found.get('cash')?.box).toEqual(words[1].box);
  });

  it('leaves a value the document does not have without a box', () => {
    const words = line(0, 'Total 10.00');
    const pages = [{ number: 1, textLayer: { source: 'pdf-text' as const, spans: words } }];
    const missing: FlatField = {
      name: 'discount',
      value: null,
      currency: null,
      page: null,
      quote: null,
    };

    const found = groundAll([flat('total', '10', '10.00'), missing], pages);

    expect(found.get('discount')).toBeNull();
  });
});
