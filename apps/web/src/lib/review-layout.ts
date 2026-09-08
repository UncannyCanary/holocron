import { type DocumentType, moneyText } from '@holocron/shared';
import type { DocumentField, FieldTrust } from './api';

// The API sends a flat list of fields named by their path through the
// extraction schema: total, line_items.0.line_total, defined_terms.0.term.
// This turns that list into the rows and sections the review screen shows,
// and keeps the order the arrow keys walk in step with what is on screen.

// One value inside a row. A line item shows three of them on one line, the
// way the document itself prints them: 10 × 4.50 = 45.00.
export type Segment = {
  field: DocumentField;
  // What goes in front of it on the line.
  before: string;
  // What the value is called on its own, for the chips on a failed check.
  label: string;
};

export type Row = {
  key: string;
  label: string;
  // A line item's description and a contract's defined term are values in
  // their own right, so the label itself can be corrected.
  labelField: DocumentField | null;
  segments: Segment[];
  // The worst state in the row, which is what the badge shows.
  trust: FieldTrust;
};

export type Group = { title: string; rows: Row[] };

export type Panel = {
  groups: Group[];
  // Every field the panel shows, in the order it shows them.
  order: DocumentField[];
  // What each field is called, by field id.
  labelOf: Map<string, string>;
};

const LABELS: Record<string, string> = {
  vendor: 'Vendor',
  bill_to: 'Bill to',
  invoice_number: 'Invoice number',
  issue_date: 'Issued',
  due_date: 'Due',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax_amount: 'Tax',
  total: 'Total',
  merchant: 'Merchant',
  purchased_at: 'Purchased',
  cash: 'Cash',
  change: 'Change',
  title: 'Title',
  effective_date: 'Effective date',
  start_date: 'Start date',
  end_date: 'End date',
  governing_law: 'Governing law',
};

// The values that head a document, and the ones that add up at the foot of
// it, for each of the three types.
const SECTIONS: Record<DocumentType, { header: string[]; totals: string[] }> = {
  invoice: {
    header: ['vendor', 'bill_to', 'invoice_number', 'issue_date', 'due_date'],
    totals: ['subtotal', 'discount', 'tax_amount', 'total'],
  },
  receipt: {
    header: ['merchant', 'purchased_at'],
    totals: ['subtotal', 'tax_amount', 'total', 'cash', 'change'],
  },
  contract: {
    header: ['title', 'effective_date', 'start_date', 'end_date', 'governing_law'],
    totals: [],
  },
};

// Worst first, the same order the queue sorts documents in.
const TRUST_RANK: Record<FieldTrust, number> = {
  contradicted: 0,
  unverifiable: 1,
  corrected: 2,
  verified: 3,
};

// A value the document does not print at all, such as a discount on an
// invoice with no discount line. The schema asked for it; the document did
// not owe it. Not the same as a value the model found but our own text layer
// could not confirm, which stays a real unverifiable.
export function isNeutral(field: DocumentField): boolean {
  return field.trust === 'unverifiable' && field.value === null;
}

export function worstTrust(fields: DocumentField[]): FieldTrust {
  return fields.reduce<FieldTrust>(
    (worst, each) =>
      !isNeutral(each) && TRUST_RANK[each.trust] < TRUST_RANK[worst] ? each.trust : worst,
    'verified',
  );
}

// The value as a person reads it. Money is padded to the digits its currency
// uses, so a total never reads 181.5 here and 181.50 on the page. The
// currency itself is shown once for the whole row, not on every amount.
export function fieldText(field: DocumentField): string {
  const value = field.value?.trim();
  if (!value) {
    return '—';
  }
  const amount = Number(value);
  if (field.currency !== null && Number.isFinite(amount)) {
    return moneyText(amount, field.currency);
  }
  return value;
}

// The currency a row is written in, shown once after its amounts.
export function rowCurrency(row: Row): string | null {
  for (const segment of row.segments) {
    if (segment.field.currency !== null && segment.field.value !== null) {
      return segment.field.currency;
    }
  }
  return null;
}

// A name we have no label for, written out as words. Nothing in the three
// schemas lands here; it is what a value we did not plan for would look like
// rather than one that quietly went missing.
function plainName(name: string): string {
  const words = name.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The numbers of the rows a list holds, in order. Lines and parties are named
// line_items.0.line_total and parties.0, so the numbers come out of the names.
function indicesOf(fields: DocumentField[], list: string): number[] {
  const shape = new RegExp(`^${list}\\.(\\d+)(\\.|$)`);
  const seen = new Set<number>();
  for (const each of fields) {
    const found = shape.exec(each.name);
    if (found !== null) {
      seen.add(Number(found[1]));
    }
  }
  return [...seen].sort((left, right) => left - right);
}

export function buildPanel(type: DocumentType, fields: DocumentField[]): Panel {
  const byName = new Map(fields.map((each) => [each.name, each]));
  const used = new Set<string>();
  const labelOf = new Map<string, string>();

  function take(name: string): DocumentField | null {
    const found = byName.get(name);
    if (!found) {
      return null;
    }
    used.add(found.id);
    return found;
  }

  function row(spec: {
    key: string;
    label: string;
    labelField: DocumentField | null;
    segments: Segment[];
  }): Row {
    const all = [
      ...(spec.labelField === null ? [] : [spec.labelField]),
      ...spec.segments.map((segment) => segment.field),
    ];
    if (spec.labelField !== null) {
      labelOf.set(spec.labelField.id, spec.label);
    }
    for (const segment of spec.segments) {
      labelOf.set(
        segment.field.id,
        segment.label === spec.label ? spec.label : `${spec.label} ${segment.label.toLowerCase()}`,
      );
    }
    return { ...spec, trust: worstTrust(all) };
  }

  function simpleRow(field: DocumentField): Row {
    const label = LABELS[field.name] ?? plainName(field.name);
    return row({
      key: field.name,
      label,
      labelField: null,
      segments: [{ field, before: '', label }],
    });
  }

  function group(title: string, rows: (Row | null)[]): Group | null {
    const kept = rows.filter((each): each is Row => each !== null);
    return kept.length === 0 ? null : { title, rows: kept };
  }

  // One line of an invoice or a receipt, printed the way the document prints
  // it. A shop receipt that shows neither a quantity nor a unit price shows
  // only its line total here, rather than a row of dashes.
  function lineRow(index: number): Row | null {
    const description = take(`line_items.${index}.description`);
    const quantity = take(`line_items.${index}.quantity`);
    const unitPrice = take(`line_items.${index}.unit_price`);
    const lineTotal = take(`line_items.${index}.line_total`);

    const counted = quantity?.value != null || unitPrice?.value != null;
    const segments: Segment[] = [];
    if (quantity !== null && counted) {
      segments.push({ field: quantity, before: '', label: 'Quantity' });
    }
    if (unitPrice !== null && counted) {
      segments.push({ field: unitPrice, before: '× ', label: 'Unit price' });
    }
    if (lineTotal !== null) {
      segments.push({
        field: lineTotal,
        before: segments.length === 0 ? '' : '= ',
        label: 'Line total',
      });
    }
    if (segments.length === 0 && description === null) {
      return null;
    }

    return row({
      key: `line_items.${index}`,
      label: description?.value?.trim() || `Line ${index + 1}`,
      labelField: description,
      segments,
    });
  }

  // A party at the start of a contract, or a name in the signature block.
  function textRow(name: string, label: string): Row | null {
    const field = take(name);
    return field === null
      ? null
      : row({ key: name, label, labelField: null, segments: [{ field, before: '', label }] });
  }

  function termRow(index: number): Row | null {
    const term = take(`defined_terms.${index}.term`);
    const use = take(`defined_terms.${index}.use`);
    if (term === null && use === null) {
      return null;
    }
    return row({
      key: `defined_terms.${index}`,
      label: term?.value?.trim() || `Term ${index + 1}`,
      labelField: term,
      segments: use === null ? [] : [{ field: use, before: '', label: 'Used' }],
    });
  }

  const sections = SECTIONS[type];
  const groups: (Group | null)[] = [
    group(
      'Header',
      sections.header.map((name) => {
        const field = take(name);
        return field === null ? null : simpleRow(field);
      }),
    ),
    group(
      'Line items',
      indicesOf(fields, 'line_items').map((index) => lineRow(index)),
    ),
    group(
      'Parties',
      indicesOf(fields, 'parties').map((index) =>
        textRow(`parties.${index}`, `Party ${index + 1}`),
      ),
    ),
    group(
      'Signature block',
      indicesOf(fields, 'signature_parties').map((index) =>
        textRow(`signature_parties.${index}`, `Signature ${index + 1}`),
      ),
    ),
    group(
      'Defined terms',
      indicesOf(fields, 'defined_terms').map((index) => termRow(index)),
    ),
    group(
      'Totals',
      sections.totals.map((name) => {
        const field = take(name);
        return field === null ? null : simpleRow(field);
      }),
    ),
  ];

  const leftover = fields.filter((each) => !used.has(each.id));
  groups.push(group('Other', leftover.map(simpleRow)));

  const kept = groups.filter((each): each is Group => each !== null);
  const order = kept.flatMap((each) =>
    each.rows.flatMap((line) => [
      ...(line.labelField === null ? [] : [line.labelField]),
      ...line.segments.map((segment) => segment.field),
    ]),
  );

  return { groups: kept, order, labelOf };
}

// The short line at the top of a failed check's card. The check's own message
// says what the numbers are; this says what kind of problem it is.
const CHECK_HEADLINES: Record<string, string> = {
  line_math: 'A line does not add up',
  subtotal: 'The lines do not add up to the subtotal',
  total: 'The total does not add up',
  change: 'The change does not match',
  one_currency: 'More than one currency',
  invoice_number: 'No invoice number',
  date_order: 'The dates are the wrong way round',
  effective_before_start: 'The dates are the wrong way round',
  start_before_end: 'The dates are the wrong way round',
  party_signed: 'A party does not sign',
  term_used: 'A defined term is never used',
};

export function checkHeadline(name: string): string {
  return CHECK_HEADLINES[name.split('.')[0]] ?? 'A check failed';
}
