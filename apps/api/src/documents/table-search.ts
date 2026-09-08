// Turns what someone typed in the table's search box into a Postgres
// full text query. Each word becomes a prefix match, so "toner" finds a line
// item description that says "toner cartridge" and "181" finds a total of
// "181.5". Punctuation that would break to_tsquery's own syntax, such as a
// colon or an ampersand, is stripped; a period is kept, since a decimal
// amount is one word to Postgres. A query with no usable words is no filter
// at all.
export function tsQueryFrom(q: string | undefined | null): string | null {
  if (!q) return null;

  const words = q
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

  if (words.length === 0) return null;

  return words.map((word) => `${word}:*`).join(' & ');
}
