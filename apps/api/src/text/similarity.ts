// How alike two pieces of text are, used wherever a near miss should still
// count as a match: a quote the model retyped slightly, a party name written
// two ways.

// The number of single letter changes that turn one text into the other.
export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

// A score from 0 to 1, where 1 is the same text. The changes are measured
// against the longer of the two, so one letter out of a short name counts for
// more than one letter out of a long one.
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
}
