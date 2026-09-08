// Money is compared in the currency's smallest unit and never as a decimal
// number, because a computer cannot hold 0.1 exactly. An amount in dollars
// becomes a whole number of cents first, and every tolerance is counted in
// those whole units.

// Most currencies split into 100 smaller units, so their smallest unit is a
// hundredth. These do not split at all: the smallest unit is one rupiah, one
// yen, one won.
const NO_DECIMALS = new Set([
  'CLP',
  'IDR',
  'ISK',
  'JPY',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
]);

// These split into 1000.
const THREE_DECIMALS = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

// How many digits after the point the currency uses. An amount with no
// currency is treated as a hundredth, which is what nearly every document we
// take is written in.
export function decimalsOf(currency: string | null): number {
  const code = (currency ?? '').trim().toUpperCase();
  if (NO_DECIMALS.has(code)) {
    return 0;
  }
  if (THREE_DECIMALS.has(code)) {
    return 3;
  }
  return 2;
}

// The amount as a whole number of the smallest unit: 12.34 dollars is 1234.
export function minorUnits(amount: number, currency: string | null): number {
  return Math.round(amount * 10 ** decimalsOf(currency));
}

// The other way round: 1234 cents is 12.34.
export function majorUnits(minor: number, currency: string | null): number {
  return minor / 10 ** decimalsOf(currency);
}

// True when two amounts are the same to within the allowance. The allowance
// is counted in the currency's smallest unit, so 1 is one cent for dollars
// and one whole rupiah for rupiah.
export function within(
  left: number,
  right: number,
  allowance: number,
  currency: string | null,
): boolean {
  return Math.abs(minorUnits(left, currency) - minorUnits(right, currency)) <= allowance;
}

// An amount written out for a person to read, with the digits its currency
// uses.
export function moneyText(amount: number, currency: string | null): string {
  return amount.toFixed(decimalsOf(currency));
}
