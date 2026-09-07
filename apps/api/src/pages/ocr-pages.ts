import type { Span } from '@holocron/shared';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { boxFromPixels } from './boxes.js';

// Where the language file is kept once it has been downloaded. Without this
// every cold start fetches it again.
const cachePath = process.env.OCR_CACHE_DIR ?? '/data/tesseract';

// One worker, kept alive for the life of the process. Each one costs about
// 130 MB, so making a new one per page would run the server out of memory.
let started: Promise<Worker> | null = null;

export async function ocrWorker(): Promise<Worker> {
  if (!started) {
    started = createWorker('eng', 1, { cachePath }).then(async (worker) => {
      // Read the page as one block of text. Letting Tesseract find the blocks
      // itself sounds better and reads our sample receipts far worse: on the
      // first one it found 34 words this way and none the other way. A scan of
      // something with real columns may want the other setting, but there is
      // no such sample to test that on yet.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return worker;
    });
  }
  return started;
}

export async function stopOcrWorker(): Promise<void> {
  if (!started) {
    return;
  }
  const worker = await started;
  started = null;
  await worker.terminate();
}

// Reads every word off a page image. Pass the dpi the image was rendered at
// when it is known, because a PNG carries no dpi of its own and Tesseract
// otherwise has to guess. Photos have no dpi to give, so they pass null.
export async function readWordsWithOcr(
  image: Buffer,
  widthPx: number,
  heightPx: number,
  dpi: number | null,
): Promise<Span[]> {
  const worker = await ocrWorker();
  await worker.setParameters({ user_defined_dpi: dpi === null ? '' : String(dpi) });

  const { data } = await worker.recognize(image, {}, { blocks: true });

  const spans: Span[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          if (word.text.trim() === '') {
            continue;
          }
          spans.push({
            text: word.text,
            box: boxFromPixels(word.bbox, widthPx, heightPx),
            confidence: word.confidence,
          });
        }
      }
    }
  }
  return spans;
}
