import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PageTextLayer } from '@holocron/shared';
import sharp from 'sharp';
import { readWordsWithOcr } from './ocr-pages.js';
import { OCR_DPI, readPdfPages } from './pdf-pages.js';

// One page of a document, ready to be stored. The caller writes the row; this
// module only makes the page image and the text layer.
export type BuiltPage = {
  number: number;
  imagePath: string;
  widthPx: number;
  heightPx: number;
  widthPt: number;
  heightPt: number;
  textLayer: PageTextLayer;
};

function isPdf(file: Buffer): boolean {
  return file.subarray(0, 5).toString('latin1') === '%PDF-';
}

// How small a photo may be before it is blown up for OCR. Tesseract finds the
// lines on a photo of a receipt much better when the picture is bigger, even
// though blowing it up adds no detail: on our first sample receipt it found 33
// words at this size against 5 at the photo's own size. It is not free. The
// second sample reads one amount fewer. More words found is the better trade,
// because a value missing from the text layer can never be checked at all.
const OCR_SHORT_EDGE = 2000;

// A photo or a scan. Straightening it first matters: a phone writes which way
// up it was held into the file rather than turning the pixels, and OCR reads
// the pixels. Turning it now means the words and the stored picture agree.
async function buildImagePage(file: Buffer, outDir: string): Promise<BuiltPage[]> {
  const { data, info } = await sharp(file).autoOrient().png().toBuffer({ resolveWithObject: true });

  // Keep the photo as it was taken. Boxes run from 0 to 1, so they fit this
  // picture just as well as the blown up one OCR reads.
  const imagePath = path.join(outDir, '1.png');
  await writeFile(imagePath, data);

  const scale = Math.max(1, OCR_SHORT_EDGE / Math.min(info.width, info.height));
  const forOcr =
    scale === 1
      ? { data, info }
      : await sharp(data)
          .resize({ width: Math.round(info.width * scale) })
          .png()
          .toBuffer({ resolveWithObject: true });

  const spans = await readWordsWithOcr(forOcr.data, forOcr.info.width, forOcr.info.height, null);

  return [
    {
      number: 1,
      imagePath,
      widthPx: info.width,
      heightPx: info.height,
      // A photo has no page size in points. Boxes are measured against the
      // picture, so its pixel size stands in for both.
      widthPt: info.width,
      heightPt: info.height,
      textLayer: { source: 'ocr-tesseract', spans },
    },
  ];
}

async function buildPdfPages(
  file: Buffer,
  outDir: string,
  options: BuildOptions,
): Promise<BuiltPage[]> {
  const pages: BuiltPage[] = [];

  // pdf.js takes a plain Uint8Array and turns a Buffer away.
  const data = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);

  for await (const page of readPdfPages(data, options)) {
    const imagePath = path.join(outDir, `${page.number}.png`);
    await writeFile(imagePath, page.image);

    // A page with its own text layer needs nothing more. A page that is only a
    // picture was rendered a second time, bigger, for OCR to read.
    const textLayer: PageTextLayer = page.ocr
      ? {
          source: 'ocr-tesseract',
          spans: await readWordsWithOcr(
            page.ocr.image,
            page.ocr.widthPx,
            page.ocr.heightPx,
            OCR_DPI,
          ),
        }
      : { source: 'pdf-text', spans: page.spans };

    pages.push({
      number: page.number,
      imagePath,
      widthPx: page.widthPx,
      heightPx: page.heightPx,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      textLayer,
    });
  }

  return pages;
}

// Turns one document into its pages: a picture of each page on disk, and a
// text layer holding every word with its box from 0 to 1, origin top left.
export type BuildOptions = {
  // A PDF with more pages than this is refused before any page is drawn.
  maxPages?: number;
};

export async function buildPages(
  filePath: string,
  outDir: string,
  options: BuildOptions = {},
): Promise<BuiltPage[]> {
  const file = await readFile(filePath);
  await mkdir(outDir, { recursive: true });

  return isPdf(file) ? buildPdfPages(file, outDir, options) : buildImagePage(file, outDir);
}
