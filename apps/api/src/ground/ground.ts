import type { Box, PageTextLayer, Span } from '@holocron/shared';
import { unionBox } from '../pages/boxes.js';
import { similarity } from '../text/similarity.js';

// Grounding is the step that decides whether a value the model gave us is
// really on the page. It never trusts the model's own coordinates. It takes
// the words the model says it copied, finds those words in the text layer we
// read ourselves, and draws the box from our words. No match, no box, and the
// field is unverifiable.

// What the model said about one value.
export type GroundInput = {
  // The value as our schema holds it: text, a number written plainly, or a
  // date written as YYYY-MM-DD.
  value: string;
  // The words the model copied off the page, or null when it found nothing.
  quote: string | null;
  // The page it read them from, counting from 1.
  page: number | null;
  // Boxes other values on this page already own. Words inside them are not
  // this value's, unless the quote appears nowhere else.
  avoid?: Box[];
  // Boxes of the values that sit on the same row, such as the other amounts
  // of a line item. When the quote appears more than once, the one nearest to
  // these wins.
  near?: Box[];
};

// One page of the document with the words we read ourselves. Every page is
// passed in, not just the one named, so that a quote sent to the wrong page
// gets no box even though the words sit on another page.
export type GroundPage = {
  number: number;
  textLayer: PageTextLayer;
};

export type Grounding = {
  page: number;
  box: Box;
};

// How alike two pieces of text have to be before a run counts as the quote.
// Below this we would rather have no box than a box around the wrong words.
const CLOSE_ENOUGH = 0.85;

// Letters OCR mixes up, folded onto one side each so that "Gl0bal" and
// "Global" are the same text to us. Both sides of every comparison go through
// this, so folding never makes a match that the page does not support.
const OCR_SLIPS: Record<string, string> = {
  o: '0',
  l: '1',
  i: '1',
  s: '5',
  b: '8',
  z: '2',
};

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// Everything that is not a letter or a number goes, spaces and punctuation
// alike. That way a quote of ("MNDA") matches a page that prints it with
// curly quotes, and $1,234.56 matches 1234.56.
function letters(text: string): string {
  let out = '';
  for (const letter of text.normalize('NFKC').toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(letter)) {
      out += letter;
    }
  }
  return out;
}

function fold(text: string): string {
  let out = '';
  for (const letter of text.replaceAll('rn', 'm')) {
    out += OCR_SLIPS[letter] ?? letter;
  }
  return out;
}

// Text made mostly of digits is matched exactly and never loosely. One digit
// out is a different amount and a different date, not a near miss.
function mostlyDigits(text: string): boolean {
  const digits = [...text].filter((letter) => /\p{N}/u.test(letter)).length;
  return digits * 2 >= text.length;
}

// The words of a run of spans, run together, with a note of which span each
// letter came from. Matching happens on this one string, so a value split
// over several words, or over two lines, is found the same way as one word.
function streamOf(keys: string[]): { text: string; owner: number[] } {
  let text = '';
  const owner: number[] = [];
  keys.forEach((key, index) => {
    text += key;
    for (let at = 0; at < key.length; at += 1) {
      owner.push(index);
    }
  });
  return { text, owner };
}

function startsWord(owner: number[], at: number): boolean {
  return at === 0 || owner[at - 1] !== owner[at];
}

function endsWord(owner: number[], at: number): boolean {
  return at === owner.length - 1 || owner[at + 1] !== owner[at];
}

type Run = [number, number];

// Every run of words that says the wanted text, each as a first and last
// span, in reading order. Exact runs win, and only the shortest of them are
// kept. Only when there is no exact run do we look for a close one, and then
// there is at most one.
function findRuns(spans: Span[], wanted: string): Run[] {
  const needle = fold(letters(wanted));
  if (needle.length === 0) {
    return [];
  }

  const keys = spans.map((span) => fold(letters(span.text)));
  const stream = streamOf(keys);
  const exact: Run[] = [];

  for (let at = stream.text.indexOf(needle); at !== -1; at = stream.text.indexOf(needle, at + 1)) {
    const end = at + needle.length - 1;
    // The match has to begin where a word begins and stop where a word stops.
    // A 2 found inside 2026 is not the value 2, and a box round 2026 would be
    // a box round the wrong words.
    if (!startsWord(stream.owner, at) || !endsWord(stream.owner, end)) {
      continue;
    }
    exact.push([stream.owner[at], stream.owner[end]]);
  }
  if (exact.length > 0) {
    const shortest = Math.min(...exact.map((run) => run[1] - run[0]));
    return exact.filter((run) => run[1] - run[0] === shortest);
  }
  if (mostlyDigits(letters(wanted))) {
    return [];
  }

  let best: Run | null = null;
  let bestScore = CLOSE_ENOUGH;
  for (let from = 0; from < spans.length; from += 1) {
    let text = '';
    for (let to = from; to < spans.length; to += 1) {
      text += keys[to];
      if (text.length > needle.length * 1.4 + 2) {
        break;
      }
      if (text.length < needle.length * 0.6) {
        continue;
      }
      const score = similarity(text, needle);
      if (score > bestScore) {
        bestScore = score;
        best = [from, to];
      }
    }
  }
  return best === null ? [] : [best];
}

function findRun(spans: Span[], wanted: string): Run | null {
  return findRuns(spans, wanted)[0] ?? null;
}

// A word that could be part of a written date: a number, a month, or the word
// between them. Anything else ends the run.
function dateWord(text: string): string | null {
  const word = text.toLowerCase().replace(/[.,]+$/, '');
  if (/^[\d/-]+$/.test(word)) {
    return word;
  }
  if (word === 'of' || (word.length >= 3 && MONTHS.some((month) => month.startsWith(word)))) {
    return word;
  }
  return null;
}

// A date is often written in words, so the value's own text, 2026-02-01, is
// nowhere on the page. This looks for the shortest run of date words that
// says the same day. Every word in the run has to belong to the date, so a
// sentence quoted around a date gives no box rather than a box round the
// sentence.
function findDate(spans: Span[], value: string): [number, number] | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (parts === null) {
    return null;
  }
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const name = MONTHS[month - 1];

  let best: [number, number] | null = null;
  for (let from = 0; from < spans.length; from += 1) {
    let words: string[] = [];
    for (let to = from; to < spans.length; to += 1) {
      const word = dateWord(spans[to].text);
      if (word === null) {
        break;
      }
      words = [...words, word];
      const numbers = (words.join(' ').match(/\d+/g) ?? []).map(Number);
      const saysMonth = words.some((each) => name.startsWith(each)) || numbers.includes(month);
      if (numbers.includes(year) && numbers.includes(day) && saysMonth) {
        if (best === null || to - from < best[1] - best[0]) {
          best = [from, to];
        }
        break;
      }
    }
  }
  return best;
}

// The words of the value inside the run the quote matched. The model often
// quotes a word or two more than the value, such as the label beside it or
// the brackets around a defined term, and those words must stay out of the
// box.
function findValue(spans: Span[], value: string): [number, number] | null {
  return findRun(spans, value) ?? findNumber(spans, value) ?? findDate(spans, value);
}

// What a word on the page says as an amount, or null when it is not one.
// Currency signs, thousands commas, and letters round the number are dropped,
// so $1,234.56 and USD181.50 read as amounts.
function amountOf(text: string): number | null {
  // Room for a currency code such as USD, but not for a label such as Total.
  if ((text.match(/\p{L}/gu) ?? []).length > 3) {
    return null;
  }
  const digits = text.replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!/\d/.test(digits)) {
    return null;
  }
  const amount = Number(digits);
  return Number.isFinite(amount) ? amount : null;
}

// Our schema holds an amount as a number, so a page that prints 181.50 hands
// us 181.5, and the two no longer look alike as text. One word that says the
// same amount is the value. Only one word: an amount never wraps. The sign is
// ignored, because a discount is printed as -150.00 and held as 150.
function findNumber(spans: Span[], value: string): [number, number] | null {
  const wanted = amountOf(value.trim());
  if (wanted === null || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return null;
  }
  const at = spans.findIndex((span) => {
    const amount = amountOf(span.text);
    return amount !== null && Math.abs(amount) === Math.abs(wanted);
  });
  return at === -1 ? null : [at, at];
}

// The box for one value, or null when the page does not back it up. The box
// is the union of the matched words: whole value, nothing else. A value that
// wraps has a box on each line and the union of those is what we store.
export function ground(field: GroundInput, pages: GroundPage[]): Grounding | null {
  if (field.quote === null || field.page === null || field.value.trim() === '') {
    return null;
  }

  const page = pages.find((each) => each.number === field.page);
  if (page === undefined) {
    return null;
  }

  const spans = page.textLayer.spans;
  const candidates: Box[] = [];
  for (const quoted of findRuns(spans, field.quote)) {
    const run = spans.slice(quoted[0], quoted[1] + 1);
    const inside = findValue(run, field.value);
    const box =
      inside === null
        ? null
        : unionBox(run.slice(inside[0], inside[1] + 1).map((span) => span.box));
    if (box !== null) {
      candidates.push(box);
    }
  }

  const box = choose(candidates, field.avoid ?? [], field.near ?? []);
  return box === null ? null : { page: page.number, box };
}

// A short quote such as "3" can be on the page more than once. The words
// another value already owns are not this one's, so those candidates go
// first, unless they are all there is. Among what is left, the one nearest
// to the rest of its row wins, else the first in reading order.
function choose(candidates: Box[], avoid: Box[], near: Box[]): Box | null {
  if (candidates.length === 0) {
    return null;
  }
  const free = candidates.filter((box) => !avoid.some((taken) => contains(taken, box)));
  const pool = free.length > 0 ? free : candidates;
  if (near.length === 0) {
    return pool[0];
  }
  // A row's values share a line, so a candidate on the same line as one of
  // them beats one that is merely close by, such as the same column one row
  // up. After that the nearest wins.
  const onLine = pool.filter((box) => near.some((other) => sharesLine(box, other)));
  const ranked = onLine.length > 0 ? onLine : pool;
  return ranked.reduce((best, box) =>
    distanceTo(box, near) < distanceTo(best, near) ? box : best,
  );
}

function sharesLine(box: Box, other: Box): boolean {
  const middle = (box.y0 + box.y1) / 2;
  return middle >= other.y0 - SLACK && middle <= other.y1 + SLACK;
}

// A little slack, since two boxes drawn from the same words can differ by a
// rounding.
const SLACK = 0.002;

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x0 >= outer.x0 - SLACK &&
    inner.y0 >= outer.y0 - SLACK &&
    inner.x1 <= outer.x1 + SLACK &&
    inner.y1 <= outer.y1 + SLACK
  );
}

// How far a box is from the nearest of some others, centre to centre.
function distanceTo(box: Box, others: Box[]): number {
  const x = (box.x0 + box.x1) / 2;
  const y = (box.y0 + box.y1) / 2;
  return Math.min(
    ...others.map((other) =>
      Math.hypot(x - (other.x0 + other.x1) / 2, y - (other.y0 + other.y1) / 2),
    ),
  );
}
