import type { Box, Span } from '@holocron/shared';

// The part of a pdf.js viewport this file uses. Width and height are the size
// of the page image we actually wrote, in pixels, so boxes are measured
// against the picture a person sees. Tests build one of these by hand, which
// is why the maths below needs no PDF.
export type RenderFrame = {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
};

// One run of text from pdf.js. A run is whatever the program that wrote the
// PDF drew in one go, so it can be a whole line, label and all.
export type TextRun = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

// How much nonsense we put up with before sending a page to OCR instead.
const UNREADABLE_SHARE = 0.2;

// True for a letter that means the page's font has no usable character map:
// one from the private use area, the replacement mark, or a control code.
// Text made of these reads as nonsense however it is printed.
function isNonsense(letter: string): boolean {
  const code = letter.codePointAt(0) ?? 0;
  return (
    (code >= 0xe000 && code <= 0xf8ff) ||
    code === 0xfffd ||
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
  );
}

function clamp(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Maps four corners in PDF points through the same viewport the page was
// rendered with, then takes the smallest box that holds them all. Going
// corner by corner is what makes a rotated run or a rotated page come out
// right: the run's own direction is in its transform, and the page's rotation
// is in the viewport.
function boxFromCorners(corners: number[][], frame: RenderFrame): Box {
  const points = corners.map(([x, y]) => frame.convertToViewportPoint(x, y));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x0: clamp(Math.min(...xs) / frame.width),
    y0: clamp(Math.min(...ys) / frame.height),
    x1: clamp(Math.max(...xs) / frame.width),
    y1: clamp(Math.max(...ys) / frame.height),
  };
}

// True for the empty and single-space runs pdf.js adds itself to hint at line
// breaks and gaps. They are guesses about layout, not text on the page, so
// they must never end up in a box.
export function isFakeSpace(run: TextRun): boolean {
  return run.height === 0 || run.width === 0 || run.str.trim() === '';
}

// Splits one run into its words and gives each word a rough box.
//
// pdf.js hands back runs, not words, so a run can hold a label and its value
// together. A box has to wrap the value and nothing else, so the run has to be
// cut up. pdf.js gives the width of the whole run but no width per letter, so
// each word can only take the share of the run that its letters take of the
// string. That is a poor guess on a font where letters differ in width: on the
// sample invoices it puts the end of "Acme" 17 pixels short. snapWordsToInk
// fixes the edges afterwards by looking at the page image. Where a run holds
// one word there is nothing to split and the box is already exact.
export function wordsFromTextRun(run: TextRun, frame: RenderFrame): Span[] {
  if (isFakeSpace(run)) {
    return [];
  }

  const [a, b, c, d, e, f] = run.transform;
  const runLength = Math.hypot(a, b);
  if (runLength === 0) {
    return [];
  }
  // The direction the run reads in. The pair c, d is the vector from the
  // baseline up to the top of the letters. Both come from the run's transform,
  // so a run drawn sideways is handled the same way as any other.
  const alongX = a / runLength;
  const alongY = b / runLength;

  const spans: Span[] = [];
  for (const match of run.str.matchAll(/\S+/g)) {
    const from = (match.index / run.str.length) * run.width;
    const to = ((match.index + match[0].length) / run.str.length) * run.width;
    const startX = e + alongX * from;
    const startY = f + alongY * from;
    const endX = e + alongX * to;
    const endY = f + alongY * to;
    spans.push({
      text: match[0],
      box: boxFromCorners(
        [
          [startX, startY],
          [endX, endY],
          [endX + c, endY + d],
          [startX + c, startY + d],
        ],
        frame,
      ),
      confidence: null,
    });
  }
  return spans;
}

// Moves the left and right edge of each word onto the real gaps between the
// words, read off the page image. The words in a run sit in one strip of the
// page, and inkColumns says, for each pixel column of that strip, whether any
// ink was printed there. The widest blank stretches are the spaces, so this
// measures where the words really start and stop instead of guessing.
//
// It gives up and leaves the guess alone when the picture does not clearly
// show one gap per space, which happens when letters touch. A rough box is
// better than a confidently wrong one.
export function snapWordsToInk(
  words: Span[],
  inkColumns: boolean[],
  stripLeft: number,
  imageWidth: number,
): Span[] {
  if (words.length < 2) {
    return words;
  }

  const firstInk = inkColumns.indexOf(true);
  const lastInk = inkColumns.lastIndexOf(true);
  if (firstInk === -1) {
    return words;
  }

  // Every blank stretch with ink on both sides of it.
  const gaps: { start: number; end: number }[] = [];
  let blankFrom = -1;
  for (let column = firstInk; column <= lastInk; column += 1) {
    if (!inkColumns[column]) {
      if (blankFrom === -1) {
        blankFrom = column;
      }
    } else if (blankFrom !== -1) {
      gaps.push({ start: blankFrom, end: column });
      blankFrom = -1;
    }
  }

  // One gap per space, or we cannot tell which blank is which.
  if (gaps.length < words.length - 1) {
    return words;
  }

  const spaces = gaps
    .slice()
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, words.length - 1)
    .sort((a, b) => a.start - b.start);

  // A word runs from the end of the space before it to the start of the space
  // after it. The first and last words stop at the ink.
  return words.map((word, index) => ({
    ...word,
    box: {
      ...word.box,
      x0: (stripLeft + (index === 0 ? firstInk : spaces[index - 1].end)) / imageWidth,
      x1:
        (stripLeft + (index === words.length - 1 ? lastInk + 1 : spaces[index].start)) / imageWidth,
    },
  }));
}

// True when a run reads straight across the page, which is the only case the
// ink reading above can handle. A run drawn sideways keeps its guessed box.
export function isHorizontal(run: TextRun): boolean {
  return run.transform[1] === 0 && run.transform[2] === 0;
}

// Turns an OCR word box, which is already in pixels from the top left, into
// the same 0 to 1 box a PDF word gets.
export function boxFromPixels(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  widthPx: number,
  heightPx: number,
): Box {
  return {
    x0: clamp(Math.min(bbox.x0, bbox.x1) / widthPx),
    y0: clamp(Math.min(bbox.y0, bbox.y1) / heightPx),
    x1: clamp(Math.max(bbox.x0, bbox.x1) / widthPx),
    y1: clamp(Math.max(bbox.y0, bbox.y1) / heightPx),
  };
}

// The smallest box holding all of them. A value that wraps over two lines has
// one box per line, and this is what gets stored.
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) {
    return null;
  }
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

// True when a page's own text layer is missing or unreadable, which means the
// page has to go through OCR. Two cases: the page is a picture with no text on
// it at all, or its font has no character map and the text is nonsense.
export function needsOcr(spans: Span[]): boolean {
  const letters = spans.map((s) => s.text).join('');
  if (letters.length === 0) {
    return true;
  }
  let bad = 0;
  for (const letter of letters) {
    if (isNonsense(letter)) {
      bad += 1;
    }
  }
  return bad / letters.length > UNREADABLE_SHARE;
}
