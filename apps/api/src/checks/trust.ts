import type { CheckResult } from './checks.js';

// Trust says how far a value can be relied on. It has two inputs and only
// two: whether the page backs the value up, and what the checks said. What
// the model thought of its own answer never comes into it.

// The four states a field's badge can show.
export type FieldTrust = 'verified' | 'unverifiable' | 'contradicted' | 'corrected';

// What the whole document shows. The queue sorts worst first, in this order.
export type DocumentTrust = 'needs-review' | 'mostly-verified' | 'verified';

// One field, as far as trust is concerned.
export type TrustField = {
  name: string;
  // A person changed this value.
  corrected: boolean;
  // The quote was found on the page, so the field has a box. A field the
  // document does not have is never grounded.
  grounded: boolean;
};

export type FieldVerdict = {
  name: string;
  trust: FieldTrust;
  // A failed check read this field. Shown beside the badge. It does not
  // change the state.
  involved: boolean;
};

// The first rule that applies wins.
//
// A correction wins even over a failed check, because the value on screen is
// then the person's, not the model's. The failed check still shows at the top
// of the review screen with its message, so nothing is hidden.
function trustOf(field: TrustField, blamed: Set<string>): FieldTrust {
  if (field.corrected) {
    return 'corrected';
  }
  if (blamed.has(field.name)) {
    return 'contradicted';
  }
  if (!field.grounded) {
    return 'unverifiable';
  }
  return 'verified';
}

// The state of every field, worked out from the checks that just ran. Only
// failed checks change anything: a passing check blames nobody.
export function trustOfFields(fields: TrustField[], checks: CheckResult[]): FieldVerdict[] {
  const failed = checks.filter((check) => !check.passed);
  const blamed = new Set(failed.flatMap((check) => check.blamed));
  const flagged = new Set(failed.flatMap((check) => check.flagged));
  return fields.map((field) => ({
    name: field.name,
    trust: trustOf(field, blamed),
    involved: flagged.has(field.name),
  }));
}

// The state of the document, worked out from its fields. A document still
// being worked on, or one that failed, shows how it is going instead of this.
export function trustOfDocument(verdicts: FieldVerdict[]): DocumentTrust {
  if (verdicts.some((verdict) => verdict.trust === 'contradicted')) {
    return 'needs-review';
  }
  if (verdicts.some((verdict) => verdict.trust === 'unverifiable')) {
    return 'mostly-verified';
  }
  return 'verified';
}
