// How many digits after the point a currency uses, and how an amount is
// written out. Both apps hold this: the API compares amounts with it and the
// screens print amounts with it, so a total never reads 181.5 in one place
// and 181.50 in the other.

// Most currencies split into 100 smaller units. These do not split at all:
// the smallest unit is one rupiah, one yen, one won.
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

// An amount with no currency is treated as a hundredth, which is what nearly
// every document we take is written in.
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

// An amount written out for a person to read, with the digits its currency
// uses.
export function moneyText(amount: number, currency: string | null): string {
  return amount.toFixed(decimalsOf(currency));
}
