import { type DocumentType, moneyText } from '@holocron/shared';
import {
  type DocumentTrust,
  type FieldTrust,
  type FieldVerdict,
  trustOfDocument,
} from '../checks/trust.js';

// One field or check, read back from the database, as far as a summary
// needs it.
export type SummaryField = {
  name: string;
  value: string | null;
  currency: string | null;
  trust: FieldTrust;
};
export type SummaryCheck = { name: string; passed: boolean; message: string };

export type DocumentTotal = { amount: string; currency: string | null };

// What the field that names the document is called, and what date counts as
// the document's own date, for each of the three types.
const NAME_FIELD: Record<DocumentType, string> = {
  invoice: 'vendor',
  receipt: 'merchant',
  contract: 'title',
};

const DATE_FIELD: Record<DocumentType, string> = {
  invoice: 'issue_date',
  receipt: 'purchased_at',
  contract: 'effective_date',
};

// Plain English for a field name, so the queue never shows a path like
// line_items.0.line_total to a bookkeeper.
const FRIENDLY_FIELD_NAMES: Record<string, string> = {
  vendor: 'the vendor',
  bill_to: 'who it is billed to',
  invoice_number: 'the invoice number',
  issue_date: 'the issue date',
  due_date: 'the due date',
  subtotal: 'the subtotal',
  discount: 'the discount',
  tax_amount: 'the tax',
  taxable_value: 'the taxable value',
  round_off: 'the round off',
  total: 'the total',
  merchant: 'the merchant',
  purchased_at: 'the date',
  cash: 'the cash amount',
  change: 'the change',
  title: 'the title',
  effective_date: 'the effective date',
  start_date: 'the start date',
  end_date: 'the end date',
  governing_law: 'the governing law',
};

const FRIENDLY_PREFIXES: Record<string, string> = {
  line_items: 'a line item',
  tax_lines: 'a tax line',
  parties: 'a party',
  signature_parties: 'a signature',
  defined_terms: 'a defined term',
};

function friendlyFieldName(name: string): string {
  const known = FRIENDLY_FIELD_NAMES[name];
  if (known) return known;
  const prefix = name.split('.')[0];
  return FRIENDLY_PREFIXES[prefix] ?? name.replace(/_/g, ' ');
}

function textOf(fields: SummaryField[], name: string): string | null {
  const value = fields.find((each) => each.name === name)?.value?.trim();
  return value ? value : null;
}

function joinWithExtra(first: string, extraCount: number): string {
  if (extraCount <= 0) return first;
  return `${first} and ${extraCount === 1 ? 'one more' : `${extraCount} more`}`;
}

// Every party named at the start of a contract, as "First Party and N more".
function partiesOf(fields: SummaryField[]): string | null {
  const parties = fields
    .filter((each) => /^parties\.\d+$/.test(each.name) && each.value?.trim())
    .map((each) => each.value as string);
  if (parties.length === 0) return null;
  return joinWithExtra(parties[0], parties.length - 1);
}

export function totalOf(type: DocumentType, fields: SummaryField[]): DocumentTotal | null {
  if (type === 'contract') return null;
  const row = fields.find((each) => each.name === 'total');
  const value = row?.value?.trim();
  if (!value) return null;
  const amount = Number(value);
  return {
    amount: Number.isFinite(amount) ? moneyText(amount, row?.currency ?? null) : value,
    currency: row?.currency ?? null,
  };
}

export function dateOf(type: DocumentType, fields: SummaryField[]): string | null {
  return textOf(fields, DATE_FIELD[type]);
}

// Who the document is with: the vendor, the merchant, or the contract's
// parties. The one thing every screen calls "vendor or party".
export function counterpartyOf(type: DocumentType, fields: SummaryField[]): string | null {
  if (type === 'contract') return partiesOf(fields);
  return textOf(fields, NAME_FIELD[type]);
}

// The name a person recognises the document by. Falls back to the uploaded
// file's own name when nothing was read from the page yet, or never could
// be, such as a receipt with a blurred store name.
export function documentDisplayName(
  type: DocumentType,
  fields: SummaryField[],
  fallback: string,
): string {
  const primary = textOf(fields, NAME_FIELD[type]);
  if (primary) return primary;
  if (type === 'receipt') {
    const total = totalOf(type, fields);
    if (total) return `Receipt, ${total.amount}${total.currency ? ` ${total.currency}` : ''}`;
  }
  return fallback;
}

// The trust badge and the one line under it, for a document that has
// finished being checked.
export function summarizeReady(
  fields: SummaryField[],
  checks: SummaryCheck[],
): { trust: DocumentTrust; why: string } {
  const verdicts: FieldVerdict[] = fields.map((each) => ({
    name: each.name,
    trust: each.trust,
    involved: false,
    // Null means the document never printed this value, so it does not
    // count as missing.
    onDocument: each.value !== null,
  }));
  const trust = trustOfDocument(verdicts);

  if (trust === 'needs-review') {
    const failed = checks.filter((each) => !each.passed);
    const first = failed[0];
    const why =
      failed.length <= 1
        ? (first?.message ?? 'A check failed.')
        : `${failed.length} of ${checks.length} checks failed. ${first.message}`;
    return { trust, why };
  }

  if (trust === 'mostly-verified') {
    const missing = [
      ...new Set(
        fields
          .filter((each) => each.trust === 'unverifiable' && each.value !== null)
          .map((each) => friendlyFieldName(each.name)),
      ),
    ];
    const why =
      missing.length === 0
        ? 'Some values could not be found on the page.'
        : missing.length <= 3
          ? `Not found on the page: ${missing.join(', ')}.`
          : `Not found on the page: ${missing.slice(0, 3).join(', ')}, and more.`;
    return { trust, why };
  }

  return { trust, why: 'Every value was found on the page and every check passed.' };
}

const STEP_LABELS: Record<string, string> = {
  received: 'Saving the file',
  rendered: 'Rendering the pages',
  text_layer: 'Reading the text',
  split: 'Looking for more than one document',
  extracted: 'Asking the model to read it',
  grounded: 'Finding values on the page',
  checked: 'Checking the numbers',
};

const STEP_ORDER = Object.keys(STEP_LABELS);

// What a document being worked on is doing right now, from the name of the
// last run step that started.
export function summarizeProcessing(latestStepName: string | null): string {
  if (latestStepName === null) return 'Reading it now.';
  const index = STEP_ORDER.indexOf(latestStepName);
  const label = STEP_LABELS[latestStepName] ?? 'Reading it';
  return index === -1 ? `${label}.` : `${label}. Step ${index + 1} of ${STEP_ORDER.length}.`;
}

// A document sits queued either because nothing has picked it up yet, or
// because a past attempt was parked for budget and is waiting to be tried
// again. The parked reason, when there is one, is already plain English.
export function summarizeQueued(parkedReason: string | null): string {
  return parkedReason ?? 'Waiting in the queue.';
}

export function summarizeFailed(error: string | null): string {
  return error ?? 'Something went wrong while reading this document.';
}
