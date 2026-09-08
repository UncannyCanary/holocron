import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { type DocumentType, type Extraction, extractionSchemas, MESSAGES } from '@holocron/shared';
import { buildContent, type ExtractPage, systemPrompt } from './prompt.js';
import { costOfUsage, isOverCap, type TokenUsage, worstCaseCost } from './spend.js';

// Room for the answer and for the model's own thinking. Kept under the point
// where the SDK asks for streaming, so one call is one plain request.
const MAX_TOKENS = 16_000;

// The stronger model does the reading. Set EXTRACTION_MODEL to
// claude-sonnet-5 to run the same code about two and a half times cheaper.
const DEFAULT_MODEL = 'claude-opus-5';

export function extractionModel(): string {
  return process.env.EXTRACTION_MODEL || DEFAULT_MODEL;
}

export type ExtractInput = {
  type: DocumentType;
  pages: ExtractPage[];
};

export type ExtractResult =
  // The model read the document and the answer fits the schema.
  | {
      status: 'extracted';
      model: string;
      extraction: Extraction;
      usage: TokenUsage;
      costUsd: number;
    }
  // Nothing was spent. The job waits and is tried again later.
  | { status: 'parked'; reason: string }
  // The call happened but there is no usable answer.
  | { status: 'failed'; error: string };

export type ExtractDeps = {
  client: Anthropic;
  // What the model has already cost this month, in dollars.
  spentThisMonthUsd: () => Promise<number>;
  model?: string;
};

// A 429 that carries no retry-after header is the vendor saying the money has
// run out for the month, not that we went too fast. Retrying cannot help, so
// the job waits instead.
function parkReasonFor(error: unknown): string | null {
  if (error instanceof Anthropic.RateLimitError && !error.headers?.get('retry-after')) {
    return MESSAGES.spendCapReached;
  }
  // The spending limit set in the console comes back as a plain bad request.
  if (
    error instanceof Anthropic.BadRequestError &&
    error.message.includes('You have reached your specified API usage limits')
  ) {
    return MESSAGES.spendCapReached;
  }
  return null;
}

// Sends one document to the model and gets typed values back, each with the
// page and the quote that grounding will look for. Counts the tokens first
// and stops before the monthly cap, so a call is never made that cannot be
// paid for.
export async function extract(input: ExtractInput, deps: ExtractDeps): Promise<ExtractResult> {
  const model = deps.model ?? extractionModel();
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: systemPrompt(input.type),
      cache_control: { type: 'ephemeral' },
    },
  ];
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildContent(input.type, input.pages) },
  ];
  const outputConfig = {
    effort: 'medium' as const,
    format: zodOutputFormat(extractionSchemas[input.type]),
  };

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
    const reason = parkReasonFor(error);
    if (reason) return { status: 'parked', reason };
    throw error;
  }

  if (message.stop_reason === 'refusal') {
    return { status: 'failed', error: 'The model would not read this document.' };
  }
  if (message.stop_reason === 'max_tokens') {
    return { status: 'failed', error: 'The model ran out of room before it finished.' };
  }

  const parsed = message as Anthropic.Message & { parsed_output?: unknown };
  const extraction = extractionSchemas[input.type].parse(parsed.parsed_output);

  return {
    status: 'extracted',
    model,
    extraction,
    usage: message.usage,
    costUsd: costOfUsage(model, message.usage),
  };
}
