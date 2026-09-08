import { describe, expect, it } from 'vitest';
import { normalizeSplit } from './split.js';

describe('normalizeSplit', () => {
  it('keeps a clean answer as it is', () => {
    expect(
      normalizeSplit(
        {
          documents: [
            { type: 'invoice', pages: [1] },
            { type: 'invoice', pages: [2, 3] },
          ],
        },
        3,
      ),
    ).toEqual([
      { type: 'invoice', pages: [1] },
      { type: 'invoice', pages: [2, 3] },
    ]);
  });

  it('gives an empty answer one document with every page', () => {
    expect(normalizeSplit(null, 2)).toEqual([{ type: 'invoice', pages: [1, 2] }]);
    expect(normalizeSplit({ documents: [] }, 2)).toEqual([{ type: 'invoice', pages: [1, 2] }]);
  });

  it('drops pages the file does not have and a page named twice', () => {
    expect(
      normalizeSplit(
        {
          documents: [
            { type: 'receipt', pages: [1, 9] },
            { type: 'receipt', pages: [1, 2] },
          ],
        },
        2,
      ),
    ).toEqual([
      { type: 'receipt', pages: [1] },
      { type: 'receipt', pages: [2] },
    ]);
  });

  it('gives a page nobody named to the document before it', () => {
    expect(
      normalizeSplit(
        {
          documents: [
            { type: 'invoice', pages: [1] },
            { type: 'contract', pages: [3] },
          ],
        },
        4,
      ),
    ).toEqual([
      { type: 'invoice', pages: [1, 2] },
      { type: 'contract', pages: [3, 4] },
    ]);
  });

  it('orders documents by their first page', () => {
    expect(
      normalizeSplit(
        {
          documents: [
            { type: 'invoice', pages: [2] },
            { type: 'invoice', pages: [1] },
          ],
        },
        2,
      ),
    ).toEqual([
      { type: 'invoice', pages: [1] },
      { type: 'invoice', pages: [2] },
    ]);
  });
});
