import { describe, expect, it } from 'vitest';
import {
  boxFromPixels,
  isFakeSpace,
  isHorizontal,
  needsOcr,
  type RenderFrame,
  snapWordsToInk,
  unionBox,
  wordsFromTextRun,
} from './boxes.js';

// Builds the same thing a pdf.js viewport gives us: a six number transform
// from PDF points to pixels on the rendered image, plus that image's size.
// The maths is pdf.js's own applyTransform, so a hand-made frame here behaves
// exactly like one from a real page.
function frame(transform: number[], width: number, height: number): RenderFrame {
  return {
    width,
    height,
    convertToViewportPoint: (x, y) => [
      transform[0] * x + transform[2] * y + transform[4],
      transform[1] * x + transform[3] * y + transform[5],
    ],
  };
}

// A Letter page the right way up. PDF points count up from the bottom left,
// pixels count down from the top left, so the viewport flips y.
function uprightLetter(scale: number): RenderFrame {
  return frame([scale, 0, 0, -scale, 0, 792 * scale], 612 * scale, 792 * scale);
}

describe('coordinate scaling', () => {
  const heading = { str: 'Invoice', transform: [24, 0, 0, 24, 72, 720], width: 84, height: 24 };

  it('puts a word where it sits on the page, counting down from the top left', () => {
    const [word] = wordsFromTextRun(heading, uprightLetter(1));

    // The word starts 72 points in from the left of a 612 point page, and its
    // top is 744 points up a 792 point page, which is 48 points down.
    expect(word.text).toBe('Invoice');
    expect(word.box.x0).toBeCloseTo(72 / 612, 6);
    expect(word.box.y0).toBeCloseTo(48 / 792, 6);
    expect(word.box.x1).toBeCloseTo(156 / 612, 6);
    expect(word.box.y1).toBeCloseTo(72 / 792, 6);
  });

  it('gives the same box whatever size the page was rendered at', () => {
    const small = wordsFromTextRun(heading, uprightLetter(1))[0];
    const large = wordsFromTextRun(heading, uprightLetter(4))[0];

    expect(large.box).toEqual(small.box);
  });

  it('leaves no PDF confidence on a word', () => {
    expect(wordsFromTextRun(heading, uprightLetter(1))[0].confidence).toBeNull();
  });
});

describe('a rotated page', () => {
  // A page marked to turn a quarter turn. pdf.js leaves the text where it was
  // and rotates the viewport instead, so the same word ends up down the right
  // hand side of the rendered image, and the image is wider than it is tall.
  const turned = frame([0, 1, 1, 0, 0, 0], 792, 612);

  it('follows the render, not the untouched text transform', () => {
    const [word] = wordsFromTextRun(
      { str: 'Rotated', transform: [18, 0, 0, 18, 72, 720], width: 100, height: 18 },
      turned,
    );

    expect(word.box.x0).toBeCloseTo(720 / 792, 6);
    expect(word.box.x1).toBeCloseTo(738 / 792, 6);
    expect(word.box.y0).toBeCloseTo(72 / 612, 6);
    expect(word.box.y1).toBeCloseTo(172 / 612, 6);
  });

  it('reads down the page, so the box is taller than it is wide', () => {
    const [word] = wordsFromTextRun(
      { str: 'Rotated', transform: [18, 0, 0, 18, 72, 720], width: 100, height: 18 },
      turned,
    );
    const boxWidth = (word.box.x1 - word.box.x0) * 792;
    const boxHeight = (word.box.y1 - word.box.y0) * 612;

    expect(boxHeight).toBeGreaterThan(boxWidth);
  });
});

describe('a run drawn sideways on an upright page', () => {
  it('follows the run to where it really goes, not straight to the right', () => {
    const [word] = wordsFromTextRun(
      { str: 'Sideways', transform: [0, 14, -14, 0, 300, 300], width: 147.87, height: 14 },
      uprightLetter(1),
    );
    const boxWidth = (word.box.x1 - word.box.x0) * 612;
    const boxHeight = (word.box.y1 - word.box.y0) * 792;

    // The run is 147.87 points long and 14 points tall. Drawn sideways that is
    // a tall thin box. Adding the width to x would have given a wide one.
    expect(boxWidth).toBeCloseTo(14, 1);
    expect(boxHeight).toBeCloseTo(147.87, 1);
  });
});

describe('a fake space', () => {
  // pdf.js adds these itself to hint at gaps and line breaks. They are its
  // guesses about layout, not text anybody put on the page.
  const gap = { str: ' ', transform: [12, 0, 0, 12, 158.72, 680], width: 241.28, height: 0 };
  const lineBreak = { str: '', transform: [12, 0, 0, 12, 72, 680], width: 0, height: 0 };

  it('is spotted', () => {
    expect(isFakeSpace(gap)).toBe(true);
    expect(isFakeSpace(lineBreak)).toBe(true);
  });

  it('makes no word, so it can never end up in a box', () => {
    expect(wordsFromTextRun(gap, uprightLetter(1))).toEqual([]);
    expect(wordsFromTextRun(lineBreak, uprightLetter(1))).toEqual([]);
  });
});

describe('a label and its value in one run', () => {
  // pdf.js hands back whatever was drawn in one go, so a label and its value
  // often arrive together. A box has to wrap the value and nothing else.
  const run = {
    str: 'Total: $1,234.56',
    transform: [12, 0, 0, 12, 72, 680],
    width: 86.72,
    height: 12,
  };

  it('splits into the label and the value', () => {
    expect(wordsFromTextRun(run, uprightLetter(1)).map((w) => w.text)).toEqual([
      'Total:',
      '$1,234.56',
    ]);
  });

  it('starts the value to the right of the label, with no overlap', () => {
    const [label, value] = wordsFromTextRun(run, uprightLetter(1));

    expect(value.box.x0).toBeGreaterThan(label.box.x1);
  });

  it('covers the whole run once the two are put together', () => {
    const words = wordsFromTextRun(run, uprightLetter(1));
    const both = unionBox(words.map((w) => w.box));

    expect(both?.x0).toBeCloseTo(72 / 612, 6);
    expect(both?.x1).toBeCloseTo((72 + 86.72) / 612, 6);
  });
});

describe('putting a word edge on the real gap', () => {
  // A picture of one strip of the page, one letter per pixel column: a hash
  // where ink was printed, a space where the paper was left blank.
  function ink(picture: string): boolean[] {
    return [...picture].map((mark) => mark === '#');
  }

  function wordsFor(...texts: string[]) {
    return texts.map((text) => ({
      text,
      box: { x0: 0, y0: 0.5, x1: 1, y1: 0.6 },
      confidence: null,
    }));
  }

  it('moves both edges onto the blank between two words', () => {
    const snapped = snapWordsToInk(wordsFor('to', 'go'), ink('##   ##'), 100, 1000);

    expect(snapped[0].box.x0).toBeCloseTo(100 / 1000, 6);
    expect(snapped[0].box.x1).toBeCloseTo(102 / 1000, 6);
    expect(snapped[1].box.x0).toBeCloseTo(105 / 1000, 6);
    expect(snapped[1].box.x1).toBeCloseTo(107 / 1000, 6);
  });

  it('leaves the top and bottom of the box alone', () => {
    const snapped = snapWordsToInk(wordsFor('to', 'go'), ink('##   ##'), 100, 1000);

    expect(snapped[0].box.y0).toBe(0.5);
    expect(snapped[0].box.y1).toBe(0.6);
  });

  it('ignores the narrow gaps inside a word and takes the wide ones', () => {
    // Two letters, a hair apart, then a real space, a word, a space, a word.
    const snapped = snapWordsToInk(wordsFor('AB', 'CDE', 'FG'), ink('## ##   ###   ##'), 0, 100);

    expect(snapped[0].box.x0).toBeCloseTo(0, 6);
    expect(snapped[0].box.x1).toBeCloseTo(0.05, 6);
    expect(snapped[1].box.x0).toBeCloseTo(0.08, 6);
    expect(snapped[1].box.x1).toBeCloseTo(0.11, 6);
    expect(snapped[2].box.x0).toBeCloseTo(0.14, 6);
    expect(snapped[2].box.x1).toBeCloseTo(0.16, 6);
  });

  it('starts at the first ink and stops at the last, whatever the strip holds', () => {
    const snapped = snapWordsToInk(wordsFor('to', 'go'), ink('  ##   ##  '), 0, 100);

    expect(snapped[0].box.x0).toBeCloseTo(0.02, 6);
    expect(snapped[1].box.x1).toBeCloseTo(0.09, 6);
  });

  it('leaves one word alone, because its box is already right', () => {
    const one = wordsFor('alone');

    expect(snapWordsToInk(one, ink('#####'), 0, 100)).toEqual(one);
  });

  it('keeps the guess when the letters touch and the spaces cannot be seen', () => {
    const two = wordsFor('to', 'go');

    expect(snapWordsToInk(two, ink('#######'), 0, 100)).toEqual(two);
  });

  it('keeps the guess when the strip is blank', () => {
    const two = wordsFor('to', 'go');

    expect(snapWordsToInk(two, ink('       '), 0, 100)).toEqual(two);
  });
});

describe('which runs can be read off the page', () => {
  it('says yes to a run that reads straight across', () => {
    expect(isHorizontal({ str: 'a', transform: [12, 0, 0, 12, 0, 0], width: 5, height: 12 })).toBe(
      true,
    );
  });

  it('says no to a run drawn sideways, which keeps its guessed box', () => {
    expect(isHorizontal({ str: 'a', transform: [0, 14, -14, 0, 0, 0], width: 5, height: 14 })).toBe(
      false,
    );
  });
});

describe('an OCR word box', () => {
  it('turns pixels from the top left into the same 0 to 1 box', () => {
    expect(boxFromPixels({ x0: 309, y0: 227, x1: 612, y1: 301 }, 2550, 3301)).toEqual({
      x0: 309 / 2550,
      y0: 227 / 3301,
      x1: 612 / 2550,
      y1: 301 / 3301,
    });
  });

  it('never runs off the page', () => {
    const box = boxFromPixels({ x0: -5, y0: 0, x1: 2600, y1: 3400 }, 2550, 3301);

    expect(box).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});

describe('putting boxes together', () => {
  it('wraps a value that runs over two lines in one box', () => {
    expect(
      unionBox([
        { x0: 0.6, y0: 0.1, x1: 0.9, y1: 0.12 },
        { x0: 0.1, y0: 0.13, x1: 0.4, y1: 0.15 },
      ]),
    ).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.15 });
  });

  it('gives no box when there is nothing to wrap', () => {
    expect(unionBox([])).toBeNull();
  });
});

describe('deciding a page needs OCR', () => {
  function words(...texts: string[]) {
    return texts.map((text) => ({
      text,
      box: { x0: 0, y0: 0, x1: 1, y1: 1 },
      confidence: null,
    }));
  }

  it('says yes to a page that is only a picture', () => {
    expect(needsOcr([])).toBe(true);
  });

  it('says yes when the font has no character map, so the text is nonsense', () => {
    expect(needsOcr(words('\uE001\uE002\uE003\uE004', '\uE005\uE006'))).toBe(true);
  });

  it('says no to a page that reads properly', () => {
    expect(needsOcr(words('Invoice', 'Total:', '$1,234.56'))).toBe(false);
  });

  it('says no when only the odd letter is unreadable', () => {
    expect(needsOcr(words('Invoice', 'Total:', '$1,234.5\uE001'))).toBe(false);
  });
});
