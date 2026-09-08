import { decimalsOf } from '@holocron/shared';

// Money is compared in the currency's smallest unit and never as a decimal
// number, because a computer cannot hold 0.1 exactly. An amount in dollars
// becomes a whole number of cents first, and every tolerance is counted in
// those whole units. How many digits a currency uses, and how an amount is
// written out for a person, are shared with the web app.

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
