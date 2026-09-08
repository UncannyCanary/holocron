import type { Box, Span } from '@holocron/shared';
import { describe, expect, it } from 'vitest';
import { unionBox } from '../pages/boxes.js';
import { type GroundPage, ground } from './ground.js';

// Lays one line of words across the page and gives each word a box, the way a
// real text layer does: 0 to 1, origin top left, reading order. Row 0 is the
// top line. The numbers are made up. The shape is what matters.
function line(row: number, text: string, confidence: number | null = null): Span[] {
  const spans: Span[] = [];
  let left = 0.08;
  for (const word of text.split(' ')) {
    const width = 0.014 * word.length;
    spans.push({
      text: word,
      box: { x0: left, y0: 0.05 + row * 0.06, x1: left + width, y1: 0.07 + row * 0.06 },
      confidence,
    });
    left += width + 0.012;
  }
  return spans;
}

function pdfPage(number: number, ...lines: Span[][]): GroundPage {
  return { number, textLayer: { source: 'pdf-text', spans: lines.flat() } };
}

function ocrPage(number: number, ...lines: Span[][]): GroundPage {
  return { number, textLayer: { source: 'ocr-tesseract', spans: lines.flat() } };
}

// The box we expect: the union of exactly these words and no others.
function boxOf(...words: Span[]): Box {
  return unionBox(words.map((word) => word.box)) as Box;
}

const vendorLine = line(0, 'Bill from Acme Global Supplies Limited');
const soldToLine = line(1, 'Sold to Northwind Trading Company');
const wrappedLine = line(2, 'Incorporated of Seattle');
const totalLine = line(3, 'Total $1,234.56 paid');
const issuedLine = line(4, 'Issued 1 Feb 2026');
const invoice = pdfPage(1, vendorLine, soldToLine, wrappedLine, totalLine, issuedLine);
const secondPage = pdfPage(2, line(0, 'Terms net 30 days'));

describe('a long vendor name', () => {
  it('boxes every word of the name and nothing around it', () => {
    const found = ground(
      {
        value: 'Acme Global Supplies Limited',
        quote: 'from Acme Global Supplies Limited',
        page: 1,
      },
      [invoice],
    );

    expect(found).toEqual({
      page: 1,
      box: boxOf(vendorLine[2], vendorLine[3], vendorLine[4], vendorLine[5]),
    });
  });
});

describe('a value that wraps onto the next line', () => {
  it('boxes the words on both lines', () => {
    const found = ground(
      {
        value: 'Northwind Trading Company Incorporated',
        quote: 'Northwind Trading Company\nIncorporated',
        page: 1,
      },
      [invoice],
    );

    expect(found).toEqual({
      page: 1,
      box: boxOf(soldToLine[2], soldToLine[3], soldToLine[4], wrappedLine[0]),
    });
  });
});

describe('a label and a value on one line', () => {
  it('boxes the value and leaves the label out', () => {
    const found = ground({ value: '1234.56', quote: 'Total $1,234.56', page: 1 }, [invoice]);

    expect(found).toEqual({ page: 1, box: boxOf(totalLine[1]) });
  });
});

describe('a quote that is not on the page', () => {
  it('gives no box', () => {
    const found = ground({ value: 'Global Widgets Ltd', quote: 'Global Widgets Ltd', page: 1 }, [
      invoice,
    ]);

    expect(found).toBeNull();
  });

  it('gives no box when the model quoted nothing', () => {
    const found = ground({ value: 'Acme Global Supplies Limited', quote: null, page: 1 }, [
      invoice,
    ]);

    expect(found).toBeNull();
  });
});

describe('a quote on the wrong page', () => {
  const field = {
    value: 'Acme Global Supplies Limited',
    quote: 'Acme Global Supplies Limited',
    page: 2,
  };

  it('gives no box, even though the words are on another page', () => {
    expect(ground(field, [invoice, secondPage])).toBeNull();
  });

  it('gives the box when the page is right', () => {
    expect(ground({ ...field, page: 1 }, [invoice, secondPage])).toEqual({
      page: 1,
      box: boxOf(vendorLine[2], vendorLine[3], vendorLine[4], vendorLine[5]),
    });
  });
});

describe('an OCR slip', () => {
  it('matches a zero read as the letter o', () => {
    const slipped = line(0, 'Acme Gl0bal Supplies Limited', 88);
    const found = ground(
      {
        value: 'Acme Global Supplies Limited',
        quote: 'Acme Global Supplies Limited',
        page: 1,
      },
      [ocrPage(1, slipped)],
    );

    expect(found).toEqual({ page: 1, box: boxOf(...slipped) });
  });

  it('matches a dropped letter', () => {
    const slipped = line(0, 'Acme Global Suplies Limited', 71);
    const found = ground(
      {
        value: 'Acme Global Supplies Limited',
        quote: 'Acme Global Supplies Limited',
        page: 1,
      },
      [ocrPage(1, slipped)],
    );

    expect(found).toEqual({ page: 1, box: boxOf(...slipped) });
  });
});

// The rest are not in the six cases. They hold the box rule to its word on the
// two shapes the fixtures from task 7 showed: a quote wider than the value,
// and a date the page writes in words.
describe('the value inside a wider quote', () => {
  it('gives no box when the value is not in the quoted words', () => {
    const found = ground({ value: '9999.00', quote: 'Total $1,234.56 paid', page: 1 }, [invoice]);

    expect(found).toBeNull();
  });

  it('boxes the date and not the words around it', () => {
    const found = ground({ value: '2026-02-01', quote: 'Issued 1 Feb 2026', page: 1 }, [invoice]);

    expect(found).toEqual({
      page: 1,
      box: boxOf(issuedLine[1], issuedLine[2], issuedLine[3]),
    });
  });
});

// A value has to be whole words on the page. A short value hiding inside a
// longer word, such as 2 inside 2026 or 45 inside 450, is not that value.
describe('a value that is part of a longer word', () => {
  const qtyLine = line(0, 'Issued 2026 Toner cartridge 2 60.00 12.00');

  it('boxes the whole word that says the value, not a word that contains it', () => {
    const found = ground({ value: '2', quote: '2', page: 1 }, [pdfPage(1, qtyLine)]);

    expect(found).toEqual({ page: 1, box: boxOf(qtyLine[4]) });
  });

  it('gives no box when the value only appears inside other words', () => {
    const found = ground({ value: '45', quote: '45', page: 1 }, [
      pdfPage(1, line(0, 'Qty 10 at 4.50 is 45.00')),
    ]);

    expect(found).toBeNull();
  });
});

// Our schema holds an amount as a number, so 181.50 on the page reaches us as
// 181.5. The page's word still says the same amount.
describe('an amount written with more decimals than the value', () => {
  it('boxes the word that says the same amount', () => {
    const amountLine = line(0, 'Total USD 181.50');
    const found = ground({ value: '181.5', quote: '181.50', page: 1 }, [pdfPage(1, amountLine)]);

    expect(found).toEqual({ page: 1, box: boxOf(amountLine[2]) });
  });

  it('boxes a discount the page prints with a minus sign', () => {
    const discountLine = line(0, 'Discount -150.00');
    const found = ground({ value: '150', quote: '-150.00', page: 1 }, [pdfPage(1, discountLine)]);

    expect(found).toEqual({ page: 1, box: boxOf(discountLine[1]) });
  });

  it('gives no box when the amount is glued to its label', () => {
    const gluedLine = line(0, 'Total:181.50 paid');
    const found = ground({ value: '181.5', quote: 'Total:181.50', page: 1 }, [
      pdfPage(1, gluedLine),
    ]);

    expect(found).toBeNull();
  });
});
