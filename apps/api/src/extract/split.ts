import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { type DocumentType, MESSAGES, type SplitAnswer, splitSchema } from '@holocron/shared';
import type { ExtractDeps } from './extract.js';
import { type ExtractPage, pageBlocks } from './prompt.js';
import { costOfUsage, isOverCap, type TokenUsage, worstCaseCost } from './spend.js';

// One file can hold more than one document: two invoices from two sellers in
// one order, or a stack of receipts scanned together. Before anything is
// read, a cheap model looks at the pages and says how many documents there
// are and which pages belong to each. This is a reading task, not a
// judgement about layouts, and the answer is checked: every page ends up in
// exactly one document, and a bad answer falls back to one document.

// A smaller model is enough for this, at a fraction of the price.
const DEFAULT_SPLIT_MODEL = 'claude-haiku-4-5-20251001';

export function splitModel(): string {
  return process.env.SPLIT_MODEL || DEFAULT_SPLIT_MODEL;
}

const MAX_TOKENS = 2_000;

export type SplitDocument = { type: DocumentType; pages: number[] };

const SYSTEM = [
  'You look at the pages of one uploaded file and say how many separate documents it holds.',
  'Most files hold one document. Some hold several: two invoices from two sellers in one order, a stack of receipts scanned together, a contract with a separate invoice attached.',
  'Every page belongs to exactly one document.',
  'A page that carries on from the one before it, with no new heading, seller, or document number, belongs to the same document.',
  'A new document starts where a new heading, a new seller, or a new document number starts.',
  'For each document give its type, invoice, receipt, or contract, and its page numbers counting from 1.',
].join('\n');

const ASK = 'Say how many documents this file holds and which pages belong to each.';

export type SplitResult =
  | {
      status: 'split';
      documents: SplitDocument[];
      model: string;
      usage: TokenUsage;
      costUsd: number;
    }
  | { status: 'parked'; reason: string }
  | { status: 'failed'; error: string };

// Makes the model's answer safe to act on. Pages outside the file are
// dropped, a page named twice stays with the first document that named it, a
// page nobody named joins the document before it, and an empty answer means
// one document with every page.
export function normalizeSplit(answer: SplitAnswer | null, pageCount: number): SplitDocument[] {
  const all = Array.from({ length: pageCount }, (_, index) => index + 1);
  const owner = new Map<number, number>();
  const documents: SplitDocument[] = [];

  for (const each of answer?.documents ?? []) {
    const pages = [...new Set(each.pages)]
      .filter((number) => Number.isInteger(number) && number >= 1 && number <= pageCount)
      .filter((number) => !owner.has(number))
      .sort((left, right) => left - right);
    if (pages.length === 0) continue;
    for (const number of pages) owner.set(number, documents.length);
    documents.push({ type: each.type, pages });
  }

  if (documents.length === 0) {
    return [{ type: answer?.documents[0]?.type ?? 'invoice', pages: all }];
  }

  documents.sort((left, right) => left.pages[0] - right.pages[0]);
  for (const number of all) {
    if (owner.has(number)) continue;
    const before = documents.filter((each) => each.pages[0] < number).at(-1) ?? documents[0];
    before.pages.push(number);
    before.pages.sort((left, right) => left - right);
  }
  return documents;
}

export async function splitFile(pages: ExtractPage[], deps: ExtractDeps): Promise<SplitResult> {
  const model = deps.model ?? splitModel();
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
  ];
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: [...pageBlocks(pages), { type: 'text', text: ASK }] },
  ];
  // No effort setting: the smaller models do not take one.
  const outputConfig = { format: zodOutputFormat(splitSchema) };

  const counted = await deps.client.messages.countTokens({
    model,
    system,
    messages,
    output_config: outputConfig,
  });
  const spent = await deps.spentThisMonthUsd();
  if (isOverCap(spent, worstCaseCost(model, counted.input_tokens, MAX_TOKENS))) {
    return { status: 'parked', reason: MESSAGES.spendCapReached };
  }

  let message: Anthropic.Message;
  try {
    message = await deps.client.messages.parse({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      output_config: outputConfig,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError && !error.headers?.get('retry-after')) {
      return { status: 'parked', reason: MESSAGES.spendCapReached };
    }
    throw error;
  }

  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    return {
      status: 'failed',
      error: 'The model could not say how many documents the file holds.',
    };
  }

  const parsed = (message as Anthropic.Message & { parsed_output?: unknown }).parsed_output;
  const answer = splitSchema.safeParse(parsed);
  return {
    status: 'split',
    documents: normalizeSplit(answer.success ? answer.data : null, pages.length),
    model,
    usage: message.usage,
    costUsd: costOfUsage(model, message.usage),
  };
}
