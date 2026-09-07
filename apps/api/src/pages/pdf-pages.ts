import { createRequire } from 'node:module';
import path from 'node:path';
import type { Span } from '@holocron/shared';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, RenderParameters } from 'pdfjs-dist/types/src/display/api.js';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport.js';
import {
  isHorizontal,
  needsOcr,
  type RenderFrame,
  snapWordsToInk,
  type TextRun,
  wordsFromTextRun,
} from './boxes.js';

// The size we keep page images at. Enough to read on screen, and small enough
// that a whole document does not fill the disk.
export const RENDER_DPI = 150;

// The size we hand to OCR. Tesseract reads badly below 300.
export const OCR_DPI = 300;

// pdf.js loads its standard fonts and character maps from disk. Without these
// two paths it falls back to the wrong glyphs and warns about it.
const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = `${path.join(pdfjsDir, 'standard_fonts')}${path.sep}`;
const cMapUrl = `${path.join(pdfjsDir, 'cmaps')}${path.sep}`;

export type PdfPage = {
  number: number;
  // The page image we keep, at RENDER_DPI.
  image: Buffer;
  widthPx: number;
  heightPx: number;
  // The page size in points, as the PDF gives it.
  widthPt: number;
  heightPt: number;
  // The words from the PDF's own text layer. Empty when there are none.
  spans: Span[];
  // A second, bigger render, only when the page has to go through OCR.
  ocr: { image: Buffer; widthPx: number; heightPx: number } | null;
};

async function renderPage(page: PDFPageProxy, dpi: number) {
  const viewport = page.getViewport({ scale: dpi / 72 });
  // The canvas is whole pixels, so boxes must be measured against these
  // rounded up numbers rather than the viewport's own fractional size.
  const widthPx = Math.ceil(viewport.width);
  const heightPx = Math.ceil(viewport.height);

  const canvas = createCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  // A page is paper. A new canvas is see-through, so paint it white first.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, widthPx, heightPx);
  // pdf.js types its canvas as the browser one. In Node it takes the Skia
  // canvas instead, which is what pdf.js's own Node example passes it.
  const params = { canvas, canvasContext: context, viewport } as unknown as RenderParameters;
  await page.render(params).promise;

  return {
    image: canvas.toBuffer('image/png'),
    widthPx,
    heightPx,
    viewport,
    pixels: context.getImageData(0, 0, widthPx, heightPx).data,
  };
}

// Boxes are measured against the image we rendered, so the words and the
// picture always agree, whatever the page's own rotation was.
function frameFor(viewport: PageViewport, widthPx: number, heightPx: number): RenderFrame {
  return {
    width: widthPx,
    height: heightPx,
    convertToViewportPoint: (x, y) => viewport.convertToViewportPoint(x, y),
  };
}

// Anything darker than this counts as ink. The page was painted white first,
// so the only other thing on it is what the PDF drew.
const INK = 200;

// For one strip of the page image, says whether each pixel column has ink.
function inkColumns(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  strip: { left: number; right: number; top: number; bottom: number },
): boolean[] {
  const columns: boolean[] = [];
  for (let x = strip.left; x < strip.right; x += 1) {
    let found = false;
    for (let y = strip.top; y < strip.bottom && !found; y += 1) {
      const at = (y * imageWidth + x) * 4;
      found = pixels[at] < INK || pixels[at + 1] < INK || pixels[at + 2] < INK;
    }
    columns.push(found);
  }
  return columns;
}

async function readWords(
  page: PDFPageProxy,
  frame: RenderFrame,
  pixels: Uint8ClampedArray,
): Promise<Span[]> {
  const content = await page.getTextContent();
  const spans: Span[] = [];

  for (const item of content.items) {
    if (!('str' in item)) {
      continue;
    }
    const run = item as TextRun;
    const words = wordsFromTextRun(run, frame);

    // One word needs no splitting, and a sideways run cannot be read this way.
    if (words.length < 2 || !isHorizontal(run)) {
      spans.push(...words);
      continue;
    }

    // The strip of the page this run was printed in. The guessed words always
    // start and end where the run does, so together they cover all of it.
    const strip = {
      left: Math.max(0, Math.floor(Math.min(...words.map((w) => w.box.x0)) * frame.width)),
      right: Math.min(
        frame.width,
        Math.ceil(Math.max(...words.map((w) => w.box.x1)) * frame.width),
      ),
      top: Math.max(0, Math.floor(Math.min(...words.map((w) => w.box.y0)) * frame.height)),
      bottom: Math.min(
        frame.height,
        Math.ceil(Math.max(...words.map((w) => w.box.y1)) * frame.height),
      ),
    };

    spans.push(
      ...snapWordsToInk(words, inkColumns(pixels, frame.width, strip), strip.left, frame.width),
    );
  }

  return spans;
}

// Walks a PDF one page at a time. One page is in memory at once, because a
// Letter page at 300 dpi is about 34 MB of canvas and the server has 2 GB.
export async function* readPdfPages(data: Uint8Array): AsyncGenerator<PdfPage> {
  const loading = getDocument({
    data,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
  });
  const pdf = await loading.promise;

  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      try {
        const rendered = await renderPage(page, RENDER_DPI);
        const frame = frameFor(rendered.viewport, rendered.widthPx, rendered.heightPx);
        const spans = await readWords(page, frame, rendered.pixels);

        // A page that is only a picture, or whose font has no character map,
        // has to be read with OCR instead. That wants a bigger render.
        let ocr: PdfPage['ocr'] = null;
        if (needsOcr(spans)) {
          const bigger = await renderPage(page, OCR_DPI);
          ocr = { image: bigger.image, widthPx: bigger.widthPx, heightPx: bigger.heightPx };
        }

        const [, , widthPt, heightPt] = page.view;
        yield {
          number,
          image: rendered.image,
          widthPx: rendered.widthPx,
          heightPx: rendered.heightPx,
          widthPt,
          heightPt,
          spans: ocr ? [] : spans,
          ocr,
        };
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await loading.destroy();
  }
}
