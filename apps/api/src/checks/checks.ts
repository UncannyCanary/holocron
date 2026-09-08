import { type DocumentType, moneyText } from '@holocron/shared';
import { similarity } from '../text/similarity.js';
import { majorUnits, minorUnits, within } from './money.js';

// The checks are the questions a document answers about itself. Does the line
// math work? Do the lines add up to the subtotal? Is the due date after the
// issue date? Nothing here asks the model anything. A check reads the values
// we already hold and says pass or fail, so the same code gives the same
// answer after a person corrects a value.
//
// Every value is looked up by name. The names are the paths through the
// extraction schema, with a number for each item of a list:
//
//   total, issue_date, invoice_number
//   line_items.0.quantity, line_items.0.unit_price, line_items.0.line_total
//   parties.0, signature_parties.0
//   defined_terms.0.term, defined_terms.0.use
//
// A check that needs a value the document does not have does not run at all.
// That field is unverifiable, which is not the same as contradicted.

// One value, as it is stored: plain text, plus the currency when it is money.
export type CheckField = {
  value: string | null;
  currency?: string | null;
};

// Every value on one document, by name.
export type CheckFields = Record<string, CheckField>;

// What one check says after it has run.
export type CheckResult = {
  // The rule that ran, with a line or party number when there is one per row.
  name: string;
  passed: boolean;
  // One line a reviewer can read, in plain English.
  message: string;
  // The fields the check works out. A failure makes these contradicted.
  blamed: string[];
  // The fields that fed the check. A failure flags these as involved.
  flagged: string[];
};

// How far out an amount may be and still pass. Counted in the currency's
// smallest unit: a cent for dollars, a whole rupiah for rupiah. Rounding on a
// single line is worth a unit; totals gather up several roundings, so they
// get five.
const LINE_ALLOWANCE = 1;
const TOTAL_ALLOWANCE = 5;

// How alike two party names have to be before they count as the same party.
// "First Bank, Inc." and "First Bank" are the same. "First Bank" and "First
// National Bank" are not, and that is worth flagging.
const SAME_PARTY = 0.9;

// Words a company name ends with that say what kind of company it is, not
// which company it is.
const COMPANY_WORDS = new Set([
  'ag',
  'bv',
  'co',
  'company',
  'corp',
  'corporation',
  'gmbh',
  'inc',
  'incorporated',
  'limited',
  'llc',
  'llp',
  'lp',
  'ltd',
  'nv',
  'plc',
  'pte',
  'pty',
  'sa',
  'sas',
]);

type Amount = {
  name: string;
  amount: number;
  currency: string | null;
};

// The value as a number, or nothing when the document does not have it or it
// is not written as a number.
function amountAt(fields: CheckFields, name: string): Amount | null {
  const field = fields[name];
  if (field === undefined || field.value === null) {
    return null;
  }
  const digits = field.value.replace(/[\s,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(digits)) {
    return null;
  }
  return { name, amount: Number(digits), currency: field.currency ?? null };
}

// The value as a date written YYYY-MM-DD, which is the one way our schema
// holds a date, so two dates can be put in order by comparing the text.
function dateAt(fields: CheckFields, name: string): string | null {
  const value = fields[name]?.value?.trim();
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

// The value as words, or nothing when it is missing or blank.
function textAt(fields: CheckFields, name: string): string | null {
  const value = fields[name]?.value?.trim();
  return value === undefined || value === '' ? null : value;
}

// The numbers of the rows a list has, in order. Lines and parties are named
// line_items.0.total and parties.0, so the numbers come out of the names.
function rowsOf(fields: CheckFields, list: string): number[] {
  const shape = new RegExp(`^${list}\\.(\\d+)(\\.|$)`);
  const seen = new Set<number>();
  for (const name of Object.keys(fields)) {
    const found = shape.exec(name);
    if (found !== null) {
      seen.add(Number(found[1]));
    }
  }
  return [...seen].sort((left, right) => left - right);
}

// A quantity is written plainly, with no trailing zeros: 3, or 1.5.
function countText(quantity: number): string {
  return String(quantity);
}

// What a document charges in tax: the one printed figure when there is one,
// else the tax lines added up, with the names of the fields that made it.
function taxOf(
  fields: CheckFields,
): { amount: number; currency: string | null; names: string[] } | null {
  const printed = amountAt(fields, 'tax_amount');
  if (printed !== null) {
    return { amount: printed.amount, currency: printed.currency, names: [printed.name] };
  }
  const lines = rowsOf(fields, 'tax_lines')
    .map((row) => amountAt(fields, `tax_lines.${row}.amount`))
    .filter((line): line is Amount => line !== null);
  if (lines.length === 0) {
    return null;
  }
  const currency = lines[0].currency;
  return {
    amount: majorUnits(
      lines.reduce((sum, line) => sum + minorUnits(line.amount, currency), 0),
      currency,
    ),
    currency,
    names: lines.map((line) => line.name),
  };
}

// Quantity times unit price, less any discount printed on the line, is the
// line total. Some documents print prices with the tax inside and some add
// the line's tax after, so a total that matches either reading passes. A
// line that does not print a quantity, which is most shop receipt lines, has
// nothing to work out and is skipped.
function lineMath(fields: CheckFields): CheckResult[] {
  const results: CheckResult[] = [];
  for (const row of rowsOf(fields, 'line_items')) {
    const quantity = amountAt(fields, `line_items.${row}.quantity`);
    const price = amountAt(fields, `line_items.${row}.unit_price`);
    const total = amountAt(fields, `line_items.${row}.line_total`);
    if (quantity === null || price === null || total === null) {
      continue;
    }
    const discount = amountAt(fields, `line_items.${row}.discount`);
    const tax = amountAt(fields, `line_items.${row}.tax`);
    const currency = total.currency ?? price.currency;
    const line = row + 1;

    const before = majorUnits(
      minorUnits(quantity.amount * price.amount, currency) -
        minorUnits(discount?.amount ?? 0, currency),
      currency,
    );
    const withTax = majorUnits(
      minorUnits(before, currency) + minorUnits(tax?.amount ?? 0, currency),
      currency,
    );
    const passed =
      within(before, total.amount, LINE_ALLOWANCE, currency) ||
      within(withTax, total.amount, LINE_ALLOWANCE, currency);

    const worked =
      `${countText(quantity.amount)} times ${moneyText(price.amount, currency)}` +
      (discount === null ? '' : ` less ${moneyText(discount.amount, currency)}`) +
      ` is ${moneyText(before, currency)}` +
      (tax === null ? '' : `, or ${moneyText(withTax, currency)} with its tax`);

    results.push({
      name: `line_math.${row}`,
      passed,
      message: passed
        ? `Line ${line} adds up.`
        : `Line ${line} says ${moneyText(total.amount, currency)}, but ${worked}.`,
      blamed: [total.name],
      flagged: [
        quantity.name,
        price.name,
        ...(discount === null ? [] : [discount.name]),
        ...(tax === null ? [] : [tax.name]),
      ],
    });
  }
  return results;
}

// A line that prints its taxable value and its tax: the two make the line
// total. Only lines that print both are checked.
function lineTax(fields: CheckFields): CheckResult[] {
  const results: CheckResult[] = [];
  for (const row of rowsOf(fields, 'line_items')) {
    const taxable = amountAt(fields, `line_items.${row}.taxable_value`);
    const tax = amountAt(fields, `line_items.${row}.tax`);
    const total = amountAt(fields, `line_items.${row}.line_total`);
    if (taxable === null || tax === null || total === null) {
      continue;
    }
    const currency = total.currency ?? taxable.currency;
    const added = majorUnits(
      minorUnits(taxable.amount, currency) + minorUnits(tax.amount, currency),
      currency,
    );
    const passed = within(added, total.amount, LINE_ALLOWANCE, currency);
    const line = row + 1;
    results.push({
      name: `line_tax.${row}`,
      passed,
      message: passed
        ? `Line ${line}'s taxable value and tax make its total.`
        : `Line ${line} says ${moneyText(total.amount, currency)}, but its taxable value ${moneyText(taxable.amount, currency)} plus its tax ${moneyText(tax.amount, currency)} is ${moneyText(added, currency)}.`,
      blamed: [total.name],
      flagged: [taxable.name, tax.name],
    });
  }
  return results;
}

// When the document prints both the tax lines and one figure for the total
// tax, the lines add up to it.
function taxLinesAddUp(fields: CheckFields): CheckResult[] {
  const printed = amountAt(fields, 'tax_amount');
  const lines = rowsOf(fields, 'tax_lines')
    .map((row) => amountAt(fields, `tax_lines.${row}.amount`))
    .filter((line): line is Amount => line !== null);
  if (printed === null || lines.length === 0) {
    return [];
  }
  const currency = printed.currency;
  const added = majorUnits(
    lines.reduce((sum, line) => sum + minorUnits(line.amount, currency), 0),
    currency,
  );
  const passed = within(added, printed.amount, TOTAL_ALLOWANCE, currency);
  return [
    {
      name: 'tax_lines',
      passed,
      message: passed
        ? 'The taxes add up to the tax total.'
        : `The taxes add up to ${moneyText(added, currency)}, but the tax total says ${moneyText(printed.amount, currency)}.`,
      blamed: ['tax_amount'],
      flagged: lines.map((line) => line.name),
    },
  ];
}

// The line totals add up to the subtotal. Every line has to have a total, or
// the sum would be short through no fault of the subtotal. When lines print
// their own discounts, a document may call the sum before those discounts
// its subtotal, so the lines' gross amounts adding up counts too.
function subtotalAddsUp(fields: CheckFields): CheckResult[] {
  const subtotal = amountAt(fields, 'subtotal');
  const rows = rowsOf(fields, 'line_items');
  const lines = rows.map((row) => amountAt(fields, `line_items.${row}.line_total`));
  if (subtotal === null || lines.length === 0 || lines.some((line) => line === null)) {
    return [];
  }
  const found = lines as Amount[];
  const currency = subtotal.currency;
  const added = majorUnits(
    found.reduce((sum, line) => sum + minorUnits(line.amount, currency), 0),
    currency,
  );

  const discounted = rows.filter((row) => amountAt(fields, `line_items.${row}.discount`) !== null);
  const gross = rows.map((row) => {
    const quantity = amountAt(fields, `line_items.${row}.quantity`);
    const price = amountAt(fields, `line_items.${row}.unit_price`);
    return quantity === null || price === null ? null : quantity.amount * price.amount;
  });
  const beforeDiscounts =
    discounted.length > 0 && gross.every((each) => each !== null)
      ? majorUnits(
          (gross as number[]).reduce((sum, each) => sum + minorUnits(each, currency), 0),
          currency,
        )
      : null;

  const passed =
    within(added, subtotal.amount, TOTAL_ALLOWANCE, currency) ||
    (beforeDiscounts !== null &&
      within(beforeDiscounts, subtotal.amount, TOTAL_ALLOWANCE, currency));
  return [
    {
      name: 'subtotal',
      passed,
      message: passed
        ? 'The lines add up to the subtotal.'
        : `The lines add up to ${moneyText(added, currency)}${
            beforeDiscounts === null
              ? ''
              : `, or ${moneyText(beforeDiscounts, currency)} before their discounts`
          }, but the subtotal says ${moneyText(subtotal.amount, currency)}.`,
      blamed: ['subtotal'],
      flagged: found.map((line) => line.name),
    },
  ];
}

// What is owed. When the document prints a taxable value, the total is that
// plus the taxes plus any round off, and the discount is already inside it.
// Otherwise the subtotal, the taxes, and any discount make the total. Tax,
// discount, and round off count as nothing when the document does not print
// them, because a document with no tax line is not a document with a missing
// tax line.
function totalAddsUp(fields: CheckFields, hasDiscount: boolean): CheckResult[] {
  const total = amountAt(fields, 'total');
  if (total === null) {
    return [];
  }
  const taxable = amountAt(fields, 'taxable_value');
  const subtotal = amountAt(fields, 'subtotal');
  if (taxable === null && subtotal === null) {
    return [];
  }
  const tax = taxOf(fields);
  const roundOff = amountAt(fields, 'round_off');
  const discount = hasDiscount && taxable === null ? amountAt(fields, 'discount') : null;
  const currency = total.currency ?? taxable?.currency ?? subtotal?.currency ?? null;

  const base = (taxable ?? subtotal) as Amount;
  const added = majorUnits(
    minorUnits(base.amount, currency) +
      minorUnits(tax?.amount ?? 0, currency) -
      minorUnits(discount?.amount ?? 0, currency) +
      minorUnits(roundOff?.amount ?? 0, currency),
    currency,
  );

  const parts = [
    taxable === null ? 'The subtotal' : 'The taxable value',
    ...(tax === null ? [] : ['tax']),
    ...(discount === null ? [] : ['discount']),
    ...(roundOff === null ? [] : ['round off']),
  ];
  const named =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  const passed = within(added, total.amount, TOTAL_ALLOWANCE, currency);
  return [
    {
      name: 'total',
      passed,
      message: passed
        ? `${named} ${parts.length === 1 ? 'matches' : 'add up to'} the total.`
        : `${named} ${parts.length === 1 ? 'is' : 'come to'} ${moneyText(added, currency)}, but the total says ${moneyText(total.amount, currency)}.`,
      blamed: ['total'],
      flagged: [
        base.name,
        ...(tax === null ? [] : tax.names),
        ...(discount === null ? [] : [discount.name]),
        ...(roundOff === null ? [] : [roundOff.name]),
      ],
    },
  ];
}

// Cash handed over less the total is the change given back. Only runs when
// the receipt prints both.
function changeAddsUp(fields: CheckFields): CheckResult[] {
  const cash = amountAt(fields, 'cash');
  const change = amountAt(fields, 'change');
  const total = amountAt(fields, 'total');
  if (cash === null || change === null || total === null) {
    return [];
  }
  const currency = total.currency ?? cash.currency;
  const owed = majorUnits(
    minorUnits(cash.amount, currency) - minorUnits(total.amount, currency),
    currency,
  );
  const passed = within(owed, change.amount, TOTAL_ALLOWANCE, currency);
  return [
    {
      name: 'change',
      passed,
      message: passed
        ? 'The cash and the change match the total.'
        : `${moneyText(cash.amount, currency)} cash less the total of ${moneyText(total.amount, currency)} leaves ${moneyText(owed, currency)}, but the change says ${moneyText(change.amount, currency)}.`,
      blamed: ['change'],
      flagged: [cash.name, total.name],
    },
  ];
}

type DateRule = {
  name: string;
  earlier: string;
  later: string;
  // True when the two may fall on the same day.
  sameDay: boolean;
  pass: string;
  fail: (earlier: string, later: string) => string;
};

// Two dates in the right order. Both have to be there for the question to
// mean anything.
function dateOrder(fields: CheckFields, rule: DateRule): CheckResult[] {
  const earlier = dateAt(fields, rule.earlier);
  const later = dateAt(fields, rule.later);
  if (earlier === null || later === null) {
    return [];
  }
  const passed = rule.sameDay ? earlier <= later : earlier < later;
  return [
    {
      name: rule.name,
      passed,
      message: passed ? rule.pass : rule.fail(earlier, later),
      blamed: [rule.earlier, rule.later],
      flagged: [],
    },
  ];
}

// Every amount on the document is in the same currency. The currency most of
// the amounts use is taken as the document's own, and the odd ones out are
// the ones blamed.
function oneCurrency(fields: CheckFields): CheckResult[] {
  const money = Object.entries(fields)
    .filter(([, field]) => field.value !== null && (field.currency ?? '').trim() !== '')
    .map(([name, field]) => ({ name, currency: (field.currency as string).trim().toUpperCase() }));
  if (money.length === 0) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const each of money) {
    counts.set(each.currency, (counts.get(each.currency) ?? 0) + 1);
  }
  // Most used wins. When two are level the first one seen wins, because a
  // Map keeps the order things were put into it.
  const [main] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  const odd = money.filter((each) => each.currency !== main);
  const others = [...new Set(odd.map((each) => each.currency))].join(' and ');
  return [
    {
      name: 'one_currency',
      passed: odd.length === 0,
      message:
        odd.length === 0
          ? `Every amount is in ${main}.`
          : `Most amounts are in ${main}, but some are in ${others}.`,
      blamed: odd.map((each) => each.name),
      flagged: money.filter((each) => each.currency === main).map((each) => each.name),
    },
  ];
}

// An invoice shows an invoice number. This is the one check that fails on a
// missing value rather than skipping: an invoice with no number is a real
// problem, not a value we happen not to be able to confirm.
function invoiceNumber(fields: CheckFields): CheckResult[] {
  const number = textAt(fields, 'invoice_number');
  return [
    {
      name: 'invoice_number',
      passed: number !== null,
      message:
        number === null
          ? 'This invoice does not show an invoice number.'
          : 'The invoice shows its number.',
      blamed: ['invoice_number'],
      flagged: [],
    },
  ];
}

// A party name with the punctuation and the kind of company taken off, so
// that "First Bank, Inc." and "First Bank" come out the same.
function partyKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');
  while (words.length > 1 && COMPANY_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(' ');
}

function samePartyAs(left: string, right: string): boolean {
  const one = partyKey(left);
  const other = partyKey(right);
  if (one === '' || other === '') {
    return false;
  }
  return one === other || similarity(one, other) >= SAME_PARTY;
}

// Every party named at the start of the contract signs at the end.
function partiesSign(fields: CheckFields): CheckResult[] {
  const signatures = rowsOf(fields, 'signature_parties')
    .map((row) => ({
      name: `signature_parties.${row}`,
      value: textAt(fields, `signature_parties.${row}`),
    }))
    .filter((each): each is { name: string; value: string } => each.value !== null);
  if (signatures.length === 0) {
    return [];
  }
  const results: CheckResult[] = [];
  for (const row of rowsOf(fields, 'parties')) {
    const party = textAt(fields, `parties.${row}`);
    if (party === null) {
      continue;
    }
    const passed = signatures.some((each) => samePartyAs(party, each.value));
    results.push({
      name: `party_signed.${row}`,
      passed,
      message: passed
        ? `${party} signs at the end.`
        : `${party} is named at the start but not in the signature block.`,
      blamed: [`parties.${row}`],
      flagged: signatures.map((each) => each.name),
    });
  }
  return results;
}

// Every term the contract defines is used at least once after it is defined.
// A term that is never used again is a sign the model read a heading as a
// definition, or that the contract defines something it forgot to say.
function termsUsed(fields: CheckFields): CheckResult[] {
  const results: CheckResult[] = [];
  for (const row of rowsOf(fields, 'defined_terms')) {
    const term = textAt(fields, `defined_terms.${row}.term`);
    if (term === null) {
      continue;
    }
    const passed = textAt(fields, `defined_terms.${row}.use`) !== null;
    results.push({
      name: `term_used.${row}`,
      passed,
      message: passed
        ? `The contract uses ${term} after defining it.`
        : `The contract defines ${term} but never uses it again.`,
      blamed: [`defined_terms.${row}.term`],
      flagged: [`defined_terms.${row}.use`],
    });
  }
  return results;
}

function invoiceChecks(fields: CheckFields): CheckResult[] {
  return [
    ...lineMath(fields),
    ...lineTax(fields),
    ...subtotalAddsUp(fields),
    ...taxLinesAddUp(fields),
    ...totalAddsUp(fields, true),
    ...dateOrder(fields, {
      name: 'date_order',
      earlier: 'issue_date',
      later: 'due_date',
      sameDay: true,
      pass: 'The issue date is on or before the due date.',
      fail: (issued, due) => `The issue date ${issued} is after the due date ${due}.`,
    }),
    ...oneCurrency(fields),
    ...invoiceNumber(fields),
  ];
}

// A receipt has no discount line and no due date. Its date, its address, and
// its number are not checked at all, so a missing one is unverifiable.
function receiptChecks(fields: CheckFields): CheckResult[] {
  return [
    ...lineMath(fields),
    ...lineTax(fields),
    ...subtotalAddsUp(fields),
    ...taxLinesAddUp(fields),
    ...totalAddsUp(fields, false),
    ...changeAddsUp(fields),
  ];
}

function contractChecks(fields: CheckFields): CheckResult[] {
  return [
    ...dateOrder(fields, {
      name: 'effective_before_start',
      earlier: 'effective_date',
      later: 'start_date',
      sameDay: true,
      pass: 'The effective date is on or before the start date.',
      fail: (effective, start) =>
        `The effective date ${effective} is after the start date ${start}.`,
    }),
    ...dateOrder(fields, {
      name: 'start_before_end',
      earlier: 'start_date',
      later: 'end_date',
      sameDay: false,
      pass: 'The start date is before the end date.',
      fail: (start, end) => `The start date ${start} is on or after the end date ${end}.`,
    }),
    ...partiesSign(fields),
    ...termsUsed(fields),
  ];
}

// Every check the document type has, run against the values we hold. Checks
// that cannot run because a value is missing are left out rather than failed.
export function runChecks(type: DocumentType, fields: CheckFields): CheckResult[] {
  if (type === 'invoice') {
    return invoiceChecks(fields);
  }
  if (type === 'receipt') {
    return receiptChecks(fields);
  }
  return contractChecks(fields);
}
