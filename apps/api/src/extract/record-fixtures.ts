import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { DocumentType } from '@holocron/shared';
import { stopOcrWorker } from '../pages/ocr-pages.js';
import { buildPages } from '../pages/pages.js';
import { samplesPath } from '../paths.js';
import { extract } from './extract.js';

// Records one real model call per document type and writes the answer to
// fixtures/. Tests read those files instead of calling the model, so the
// suite is free to run and always gives the same answer.
//
// Build the API first, then run it from the repo root with:
//   node --env-file=.env apps/api/dist/extract/record-fixtures.js
//
// It spends real money, well under a dollar for the four calls, so run it only
// when the schema or the prompt changes.

const SAMPLES: Array<{ type: DocumentType; file: string; fixture: string }> = [
  { type: 'invoice', file: 'invoices/invoice-3-planted-error.pdf', fixture: 'invoice' },
  { type: 'invoice', file: 'invoices/invoice-4-gst.pdf', fixture: 'invoice-gst' },
  { type: 'receipt', file: 'receipts/cord-receipt-1.jpg', fixture: 'receipt' },
  { type: 'contract', file: 'contracts/common-paper-mutual-nda.pdf', fixture: 'contract' },
];

// Written next to the source, not next to the build, because the tests read
// them from there. This is why the script is run from the repo root.
const fixturesDir = path.resolve('apps/api/src/extract/fixtures');

// Pass fixture names to record only those, such as: ... record-fixtures.js invoice-gst
async function main() {
  const client = new Anthropic();
  const workDir = await mkdtemp(path.join(tmpdir(), 'holocron-fixtures-'));
  let spent = 0;
  const only = process.argv.slice(2);
  const wanted = only.length === 0 ? SAMPLES : SAMPLES.filter((s) => only.includes(s.fixture));

  for (const sample of wanted) {
    const filePath = samplesPath(sample.file);
    const built = await buildPages(filePath, path.join(workDir, sample.type));
    const pages = await Promise.all(
      built.map(async (page) => ({
        number: page.number,
        image: await readFile(page.imagePath),
        textLayer: page.textLayer,
      })),
    );

    const result = await extract(
      { type: sample.type, pages },
      { client, spentThisMonthUsd: async () => spent },
    );

    if (result.status !== 'extracted') {
      console.error(`${sample.type}: ${result.status}`);
      continue;
    }

    spent += result.costUsd;
    const fixture = {
      document: path.posix.join('samples', sample.file),
      pages: pages.length,
      recordedAt: new Date().toISOString().slice(0, 10),
      model: result.model,
      effort: 'medium',
      usage: result.usage,
      costUsd: Number(result.costUsd.toFixed(4)),
      output: result.extraction,
    };
    await writeFile(
      path.join(fixturesDir, `${sample.fixture}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );

    console.log(
      `${sample.type}: ${pages.length} page(s), ${result.usage.input_tokens} in, ` +
        `${result.usage.output_tokens} out, $${result.costUsd.toFixed(4)}`,
    );
  }

  console.log(`Total for this run: $${spent.toFixed(4)}`);
  await stopOcrWorker();
}

main();
