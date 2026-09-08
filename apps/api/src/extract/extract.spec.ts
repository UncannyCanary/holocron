import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { DocumentType, InvoiceExtraction, ReceiptExtraction } from '@holocron/shared';
import { MESSAGES } from '@holocron/shared';
import { describe, expect, it, vi } from 'vitest';
import { type ExtractInput, extract } from './extract.js';

// One recorded answer from a real call, one per document type. See
// record-fixtures.ts for how they were made.
type Fixture = {
  document: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  costUsd: number;
  output: unknown;
};

function fixture(type: DocumentType): Fixture {
  const file = fileURLToPath(new URL(`fixtures/${type}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8'));
}

// One page is enough to build a request. The stub client never looks at it.
function input(type: DocumentType): ExtractInput {
  return {
    type,
    pages: [
      {
        number: 1,
        image: Buffer.from('a page image'),
        textLayer: { source: 'pdf-text', spans: [] },
      },
    ],
  };
}

// Stands in for the model. It answers with the recorded reply, so the tests
// run without a key, without the network, and without spending anything.
function stubClient(reply: { stop_reason?: string; usage?: unknown; parsed_output?: unknown }) {
  const parse = vi.fn(async () => ({
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
    ...reply,
  }));
  const countTokens = vi.fn(async () => ({ input_tokens: 5000 }));
  return { client: { messages: { parse, countTokens } } as unknown as Anthropic, parse };
}

function replyFrom(type: DocumentType) {
  const recorded = fixture(type);
  return { usage: recorded.usage, parsed_output: recorded.output };
}

describe('extract', () => {
  it('turns the recorded invoice answer into typed values, quotes and all', async () => {
    const recorded = fixture('invoice');
    const { client } = stubClient(replyFrom('invoice'));

    const result = await extract(input('invoice'), {
      client,
      spentThisMonthUsd: async () => 0,
      model: 'claude-opus-5',
    });

    expect(result.status).toBe('extracted');
    if (result.status !== 'extracted') return;
    const invoice = result.extraction as InvoiceExtraction;

    expect(invoice.vendor.value).toBe('Acme Supplies');
    expect(invoice.total.value).toBe(181.5);
    expect(invoice.total.currency).toBe('USD');
    expect(invoice.total.quote).toBe('181.50');
    expect(invoice.total.page).toBe(1);
    expect(invoice.line_items).toHaveLength(2);
    // The planted error is copied down as printed, not quietly put right.
    expect(invoice.line_items[1].line_total.value).toBe(12);
    expect(result.costUsd).toBeCloseTo(recorded.costUsd, 3);
    expect(result.model).toBe('claude-opus-5');
  });

  // The photo receipt has amounts in its text layer but no item names, so the
  // model reads the names off the picture and leaves them without a quote.
  // Those become unverifiable later, which is the honest answer.
  it('keeps a receipt value that has no quote', async () => {
    const { client } = stubClient(replyFrom('receipt'));

    const result = await extract(input('receipt'), {
      client,
      spentThisMonthUsd: async () => 0,
    });

    expect(result.status).toBe('extracted');
    if (result.status !== 'extracted') return;
    const receipt = result.extraction as ReceiptExtraction;

    expect(receipt.total.value).toBe(91000);
    expect(receipt.total.quote).toBe('91000');
    expect(receipt.line_items[0].description.value).toBe('J.STB PROMO');
    expect(receipt.line_items[0].description.quote).toBeNull();
    expect(receipt.line_items[0].description.page).toBeNull();
  });

  it('turns the recorded contract answer into typed values', async () => {
    const { client } = stubClient(replyFrom('contract'));

    const result = await extract(input('contract'), {
      client,
      spentThisMonthUsd: async () => 0,
    });

    expect(result.status).toBe('extracted');
    if (result.status !== 'extracted') return;
    expect(result.extraction).toMatchObject({
      title: { value: 'Mutual Non-Disclosure Agreement' },
      governing_law: { value: 'Delaware' },
    });
  });

  it('parks the job and calls nothing when the month is spent', async () => {
    const { client, parse } = stubClient(replyFrom('invoice'));

    const result = await extract(input('invoice'), {
      client,
      spentThisMonthUsd: async () => 14.9,
      model: 'claude-opus-5',
    });

    expect(result).toEqual({ status: 'parked', reason: MESSAGES.spendCapReached });
    expect(parse).not.toHaveBeenCalled();
  });

  it('parks the job when the model says the money has run out', async () => {
    const { client } = stubClient(replyFrom('invoice'));
    client.messages.parse = vi.fn(async () => {
      throw new Anthropic.RateLimitError(429, {}, 'spend cap', new Headers());
    }) as never;

    const result = await extract(input('invoice'), { client, spentThisMonthUsd: async () => 0 });

    expect(result).toEqual({ status: 'parked', reason: MESSAGES.spendCapReached });
  });

  // A 429 that says when to come back is ordinary rate limiting. The worker
  // retries that itself, so it must not be swallowed here.
  it('passes on a rate limit that says when to try again', async () => {
    const { client } = stubClient(replyFrom('invoice'));
    client.messages.parse = vi.fn(async () => {
      throw new Anthropic.RateLimitError(
        429,
        {},
        'slow down',
        new Headers({ 'retry-after': '30' }),
      );
    }) as never;

    await expect(
      extract(input('invoice'), { client, spentThisMonthUsd: async () => 0 }),
    ).rejects.toBeInstanceOf(Anthropic.RateLimitError);
  });

  it('fails plainly when the model will not read the document', async () => {
    const { client } = stubClient({ stop_reason: 'refusal' });

    const result = await extract(input('invoice'), { client, spentThisMonthUsd: async () => 0 });

    expect(result.status).toBe('failed');
  });

  it('fails plainly when the answer was cut off', async () => {
    const { client } = stubClient({ stop_reason: 'max_tokens' });

    const result = await extract(input('invoice'), { client, spentThisMonthUsd: async () => 0 });

    expect(result.status).toBe('failed');
  });
});
