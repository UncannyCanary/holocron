import { LIMITS } from '@holocron/shared';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { run } from '../db/schema.js';

// Dollars per million tokens, from the pricing page on 2026-09-06. Kept next
// to the code that spends the money so the cap is worked out from the same
// numbers the research used.
export const MODEL_PRICES = {
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

export type PricedModel = keyof typeof MODEL_PRICES;

export function isPricedModel(model: string): model is PricedModel {
  return model in MODEL_PRICES;
}

function pricesFor(model: string) {
  if (!isPricedModel(model)) {
    throw new Error(`No price is known for ${model}.`);
  }
  return MODEL_PRICES[model];
}

// Tokens as the API reports them after a call.
export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// What one finished call really cost.
export function costOfUsage(model: string, usage: TokenUsage): number {
  const prices = pricesFor(model);
  return (
    (usage.input_tokens * prices.input +
      usage.output_tokens * prices.output +
      (usage.cache_creation_input_tokens ?? 0) * prices.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * prices.cacheRead) /
    1_000_000
  );
}

// The most a call could cost: the tokens we counted before sending, plus
// every output token the call is allowed to write. Real calls come in well
// under this. That is the point. Guessing high means the cap is reached a
// little early rather than passed.
export function worstCaseCost(model: string, inputTokens: number, maxTokens: number): number {
  const prices = pricesFor(model);
  return (inputTokens * prices.input + maxTokens * prices.output) / 1_000_000;
}

export function isOverCap(
  spentThisMonthUsd: number,
  worstCaseUsd: number,
  capUsd: number = LIMITS.monthlyModelSpendUsd,
): boolean {
  return spentThisMonthUsd + worstCaseUsd > capUsd;
}

// The first moment of this month, in UTC. The cap is a calendar month, the
// same month the vendor bills.
export function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// What the model has cost this month. The run rows are the ledger: each one
// records the model it used and how many tokens it spent, so there is no
// second tally to keep in step. Cached tokens are not stored on a run, so
// every input token is counted at full price, which reads a little high.
export async function spentThisMonth(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .select({
      model: run.model,
      inputTokens: sql<number>`coalesce(sum(${run.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${run.outputTokens}), 0)::int`,
    })
    .from(run)
    .where(and(gte(run.startedAt, startOfMonth(now)), isNotNull(run.model)))
    .groupBy(run.model);

  let total = 0;
  for (const row of rows) {
    if (!row.model || !isPricedModel(row.model)) continue;
    total += costOfUsage(row.model, {
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
    });
  }
  return total;
}
