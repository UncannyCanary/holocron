import { describe, expect, it } from 'vitest';
import { type CheckFields, type CheckResult, runChecks } from './checks.js';

// A money value as it is stored: the number written plainly, plus its
// currency.
function money(amount: number | null, currency = 'USD'): CheckFields[string] {
  return { value: amount === null ? null : String(amount), currency };
}

// Anything that is not money: a name, a date, a quantity.
function words(value: string | null): CheckFields[string] {
  return { value, currency: null };
}

// An invoice where everything agrees: two lines, 36.00 and 20.00, a subtotal
// of 56.00, tax of 5.00, a discount of 1.00, and a total of 60.00.
function invoice(changes: CheckFields = {}): CheckFields {
  return {
    vendor: words('Acme Global Supplies Limited'),
    invoice_number: words('INV-1042'),
    issue_date: words('2026-02-01'),
    due_date: words('2026-03-03'),
    'line_items.0.description': words('Blue widget'),
    'line_items.0.quantity': words('3'),
    'line_items.0.unit_price': money(12),
    'line_items.0.line_total': money(36),
    'line_items.1.description': words('Red widget'),
    'line_items.1.quantity': words('2'),
    'line_items.1.unit_price': money(10),
    'line_items.1.line_total': money(20),
    subtotal: money(56),
    tax_amount: money(5),
    discount: money(1),
    total: money(60),
    ...changes,
  };
}

// A shop receipt: no quantities on the lines, a subtotal, tax, cash, change.
function receipt(changes: CheckFields = {}): CheckFields {
  return {
    merchant: words('Corner Store'),
    purchased_at: words('2026-02-04'),
    'line_items.0.description': words('Coffee'),
    'line_items.0.quantity': words(null),
    'line_items.0.unit_price': money(null),
    'line_items.0.line_total': money(4.5),
    'line_items.1.description': words('Bun'),
    'line_items.1.quantity': words(null),
    'line_items.1.unit_price': money(null),
    'line_items.1.line_total': money(3.25),
    subtotal: money(7.75),
    tax_amount: money(0.62),
    total: money(8.37),
    cash: money(20),
    change: money(11.63),
    ...changes,
  };
}

function contract(changes: CheckFields = {}): CheckFields {
  return {
    title: words('Mutual Non-Disclosure Agreement'),
    'parties.0': words('Northwind Trading Company'),
    'parties.1': words('First Bank, Inc.'),
    'signature_parties.0': words('Northwind Trading Company'),
    'signature_parties.1': words('First Bank'),
    effective_date: words('2026-01-15'),
    start_date: words('2026-02-01'),
    end_date: words('2027-02-01'),
    'defined_terms.0.term': words('Disclosing Party'),
    'defined_terms.0.use': words('the Disclosing Party shall mark'),
    ...changes,
  };
}

function checkNamed(results: CheckResult[], name: string): CheckResult {
  const found = results.find((result) => result.name === name);
  if (found === undefined) {
    throw new Error(`no check called ${name} ran`);
  }
  return found;
}

function ran(results: CheckResult[], name: string): boolean {
  return results.some((result) => result.name === name);
}

describe('line math', () => {
  it('passes when quantity times unit price is the line total', () => {
    expect(checkNamed(runChecks('invoice', invoice()), 'line_math.0').passed).toBe(true);
  });

  it('fails when the line total is wrong, and says both numbers', () => {
    const result = checkNamed(
      runChecks('invoice', invoice({ 'line_items.0.line_total': money(35) })),
      'line_math.0',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe('Line 1 says 35.00, but 3 times 12.00 is 36.00.');
  });

  it('blames the line total and flags the quantity and the unit price', () => {
    const result = checkNamed(
      runChecks('invoice', invoice({ 'line_items.0.line_total': money(35) })),
      'line_math.0',
    );

    expect(result.blamed).toEqual(['line_items.0.line_total']);
    expect(result.flagged).toEqual(['line_items.0.quantity', 'line_items.0.unit_price']);
  });

  it('allows one cent, and no more', () => {
    const near = runChecks('invoice', invoice({ 'line_items.0.line_total': money(36.01) }));
    const far = runChecks('invoice', invoice({ 'line_items.0.line_total': money(36.02) }));

    expect(checkNamed(near, 'line_math.0').passed).toBe(true);
    expect(checkNamed(far, 'line_math.0').passed).toBe(false);
  });

  it('does not run on a line with no quantity', () => {
    expect(ran(runChecks('receipt', receipt()), 'line_math.0')).toBe(false);
  });

  it('runs on a receipt line that does print a quantity', () => {
    const results = runChecks(
      'receipt',
      receipt({ 'line_items.0.quantity': words('2'), 'line_items.0.unit_price': money(2.25) }),
    );

    expect(checkNamed(results, 'line_math.0').passed).toBe(true);
  });

  it('counts in whole units for a currency with no decimals', () => {
    const rupiah = {
      'line_items.0.quantity': words('2'),
      'line_items.0.unit_price': money(12_500, 'IDR'),
      'line_items.0.line_total': money(25_001, 'IDR'),
    };
    const near = runChecks('receipt', receipt(rupiah));
    const far = runChecks(
      'receipt',
      receipt({ ...rupiah, 'line_items.0.line_total': money(25_002, 'IDR') }),
    );

    expect(checkNamed(near, 'line_math.0').passed).toBe(true);
    expect(checkNamed(far, 'line_math.0').passed).toBe(false);
  });
});

describe('the lines add up to the subtotal', () => {
  it('passes when they do', () => {
    expect(checkNamed(runChecks('invoice', invoice()), 'subtotal').passed).toBe(true);
  });

  it('fails when they do not, and says what the lines come to', () => {
    const result = checkNamed(runChecks('invoice', invoice({ subtotal: money(55) })), 'subtotal');

    expect(result.passed).toBe(false);
    expect(result.message).toBe('The lines add up to 56.00, but the subtotal says 55.00.');
    expect(result.blamed).toEqual(['subtotal']);
    expect(result.flagged).toEqual(['line_items.0.line_total', 'line_items.1.line_total']);
  });

  it('allows five cents, and no more', () => {
    const near = runChecks('invoice', invoice({ subtotal: money(56.05) }));
    const far = runChecks('invoice', invoice({ subtotal: money(56.06) }));

    expect(checkNamed(near, 'subtotal').passed).toBe(true);
    expect(checkNamed(far, 'subtotal').passed).toBe(false);
  });

  it('does not run when a line total is missing', () => {
    const results = runChecks('invoice', invoice({ 'line_items.1.line_total': money(null) }));

    expect(ran(results, 'subtotal')).toBe(false);
  });

  it('does not run when the document has no lines', () => {
    expect(ran(runChecks('invoice', { subtotal: money(56) }), 'subtotal')).toBe(false);
  });
});

describe('the subtotal, tax and discount add up to the total', () => {
  it('passes when they do', () => {
    expect(checkNamed(runChecks('invoice', invoice()), 'total').passed).toBe(true);
  });

  it('fails when they do not', () => {
    const result = checkNamed(runChecks('invoice', invoice({ total: money(61) })), 'total');

    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      'The subtotal, tax and discount come to 60.00, but the total says 61.00.',
    );
    expect(result.blamed).toEqual(['total']);
    expect(result.flagged).toEqual(['subtotal', 'tax_amount', 'discount']);
  });

  it('allows five cents, and no more', () => {
    const near = runChecks('invoice', invoice({ total: money(60.05) }));
    const far = runChecks('invoice', invoice({ total: money(60.06) }));

    expect(checkNamed(near, 'total').passed).toBe(true);
    expect(checkNamed(far, 'total').passed).toBe(false);
  });

  it('counts a missing tax or discount line as nothing', () => {
    const results = runChecks(
      'invoice',
      invoice({ tax_amount: money(null), discount: money(null), total: money(56) }),
    );

    expect(checkNamed(results, 'total').passed).toBe(true);
    expect(checkNamed(results, 'total').flagged).toEqual(['subtotal']);
  });

  it('leaves the discount out on a receipt', () => {
    const result = checkNamed(runChecks('receipt', receipt()), 'total');

    expect(result.passed).toBe(true);
    expect(result.message).toBe('The subtotal and tax add up to the total.');
  });

  it('does not run when the total is missing', () => {
    expect(ran(runChecks('invoice', invoice({ total: money(null) })), 'total')).toBe(false);
  });
});

describe('cash less the total is the change', () => {
  it('passes when it is', () => {
    expect(checkNamed(runChecks('receipt', receipt()), 'change').passed).toBe(true);
  });

  it('fails when it is not', () => {
    const result = checkNamed(runChecks('receipt', receipt({ change: money(11.5) })), 'change');

    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      '20.00 cash less the total of 8.37 leaves 11.63, but the change says 11.50.',
    );
    expect(result.blamed).toEqual(['change']);
    expect(result.flagged).toEqual(['cash', 'total']);
  });

  it('does not run when the receipt does not print the cash', () => {
    expect(ran(runChecks('receipt', receipt({ cash: money(null) })), 'change')).toBe(false);
  });
});

describe('the dates are in order', () => {
  it('passes when the issue date is before the due date', () => {
    expect(checkNamed(runChecks('invoice', invoice()), 'date_order').passed).toBe(true);
  });

  it('passes when they are the same day', () => {
    const results = runChecks('invoice', invoice({ due_date: words('2026-02-01') }));

    expect(checkNamed(results, 'date_order').passed).toBe(true);
  });

  it('fails when the issue date is after the due date', () => {
    const result = checkNamed(
      runChecks('invoice', invoice({ due_date: words('2026-01-20') })),
      'date_order',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe('The issue date 2026-02-01 is after the due date 2026-01-20.');
    expect(result.blamed).toEqual(['issue_date', 'due_date']);
  });

  it('does not run when one date is missing', () => {
    expect(ran(runChecks('invoice', invoice({ due_date: words(null) })), 'date_order')).toBe(false);
  });
});

describe('one currency', () => {
  it('passes when every amount is in the same one', () => {
    const result = checkNamed(runChecks('invoice', invoice()), 'one_currency');

    expect(result.passed).toBe(true);
    expect(result.message).toBe('Every amount is in USD.');
  });

  it('fails and blames the odd one out', () => {
    const result = checkNamed(
      runChecks('invoice', invoice({ total: money(60, 'EUR') })),
      'one_currency',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe('Most amounts are in USD, but some are in EUR.');
    expect(result.blamed).toEqual(['total']);
  });

  it('does not run on a document with no amounts', () => {
    expect(ran(runChecks('invoice', { invoice_number: words('INV-1') }), 'one_currency')).toBe(
      false,
    );
  });
});

describe('the invoice number', () => {
  it('passes when the invoice shows one', () => {
    expect(checkNamed(runChecks('invoice', invoice()), 'invoice_number').passed).toBe(true);
  });

  it('fails when it is missing, unlike every other check', () => {
    const result = checkNamed(
      runChecks('invoice', invoice({ invoice_number: words(null) })),
      'invoice_number',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe('This invoice does not show an invoice number.');
    expect(result.blamed).toEqual(['invoice_number']);
  });

  it('fails when it is blank', () => {
    const results = runChecks('invoice', invoice({ invoice_number: words('   ') }));

    expect(checkNamed(results, 'invoice_number').passed).toBe(false);
  });
});

describe('contract dates', () => {
  it('passes when the effective date is on or before the start date', () => {
    const results = runChecks('contract', contract());

    expect(checkNamed(results, 'effective_before_start').passed).toBe(true);
    expect(checkNamed(results, 'start_before_end').passed).toBe(true);
  });

  it('fails when the effective date is after the start date', () => {
    const result = checkNamed(
      runChecks('contract', contract({ effective_date: words('2026-03-01') })),
      'effective_before_start',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      'The effective date 2026-03-01 is after the start date 2026-02-01.',
    );
  });

  it('fails when the start date and the end date are the same day', () => {
    const result = checkNamed(
      runChecks('contract', contract({ end_date: words('2026-02-01') })),
      'start_before_end',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      'The start date 2026-02-01 is on or after the end date 2026-02-01.',
    );
  });
});

describe('every party signs', () => {
  it('passes when the signature block names the same company written another way', () => {
    const results = runChecks('contract', contract());

    expect(checkNamed(results, 'party_signed.0').passed).toBe(true);
    expect(checkNamed(results, 'party_signed.1').passed).toBe(true);
    expect(checkNamed(results, 'party_signed.1').message).toBe(
      'First Bank, Inc. signs at the end.',
    );
  });

  it('fails when a different company signs', () => {
    const result = checkNamed(
      runChecks('contract', contract({ 'signature_parties.1': words('First National Bank') })),
      'party_signed.1',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      'First Bank, Inc. is named at the start but not in the signature block.',
    );
    expect(result.blamed).toEqual(['parties.1']);
    expect(result.flagged).toEqual(['signature_parties.0', 'signature_parties.1']);
  });

  it('passes through a small spelling slip', () => {
    const results = runChecks(
      'contract',
      contract({ 'signature_parties.0': words('Northwind Tradng Company') }),
    );

    expect(checkNamed(results, 'party_signed.0').passed).toBe(true);
  });

  it('does not run when the contract has no signature block', () => {
    const bare = contract();
    delete bare['signature_parties.0'];
    delete bare['signature_parties.1'];

    expect(ran(runChecks('contract', bare), 'party_signed.0')).toBe(false);
  });
});

describe('every defined term is used', () => {
  it('passes when the contract uses it again', () => {
    expect(checkNamed(runChecks('contract', contract()), 'term_used.0').passed).toBe(true);
  });

  it('fails when it is never used again', () => {
    const result = checkNamed(
      runChecks('contract', contract({ 'defined_terms.0.use': words(null) })),
      'term_used.0',
    );

    expect(result.passed).toBe(false);
    expect(result.message).toBe('The contract defines Disclosing Party but never uses it again.');
    expect(result.blamed).toEqual(['defined_terms.0.term']);
    expect(result.flagged).toEqual(['defined_terms.0.use']);
  });
});

describe('a document with nothing to check', () => {
  it('runs no checks at all on an empty contract', () => {
    expect(runChecks('contract', {})).toEqual([]);
  });

  it('runs no checks at all on an empty receipt', () => {
    expect(runChecks('receipt', {})).toEqual([]);
  });
});
