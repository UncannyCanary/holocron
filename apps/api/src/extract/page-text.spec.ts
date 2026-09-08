import type { PageTextLayer } from '@holocron/shared';
import { describe, expect, it } from 'vitest';
import { textLayerToText } from './page-text.js';

// Words sit on a line about this tall, the height of ordinary print on a page.
function word(text: string, x0: number, middle: number): PageTextLayer['spans'][number] {
  return {
    text,
    box: { x0, y0: middle - 0.01, x1: x0 + 0.05, y1: middle + 0.01 },
    confidence: null,
  };
}

describe('textLayerToText', () => {
  it('joins the words of one line with single spaces', () => {
    const layer: PageTextLayer = {
      source: 'pdf-text',
      spans: [word('Total', 0.1, 0.5), word('USD', 0.3, 0.5), word('181.50', 0.4, 0.5)],
    };
    expect(textLayerToText(layer)).toBe('Total USD 181.50');
  });

  it('starts a new line when the next word sits below the one before', () => {
    const layer: PageTextLayer = {
      source: 'pdf-text',
      spans: [word('Subtotal', 0.1, 0.5), word('165.00', 0.8, 0.5), word('Tax', 0.1, 0.56)],
    };
    expect(textLayerToText(layer)).toBe('Subtotal 165.00\nTax');
  });

  // A word that rides a little high or low, as OCR often reads them, still
  // belongs to the line it was printed on.
  it('keeps a slightly crooked word on the same line', () => {
    const layer: PageTextLayer = {
      source: 'ocr-tesseract',
      spans: [word('Cash', 0.1, 0.5), word('91000', 0.7, 0.5045)],
    };
    expect(textLayerToText(layer)).toBe('Cash 91000');
  });

  it('gives an empty page an empty text', () => {
    expect(textLayerToText({ source: 'pdf-text', spans: [] })).toBe('');
  });
});
