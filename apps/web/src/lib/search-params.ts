// A plain, flat query string instead of the router's default JSON-per-key
// one, so a filtered table's address reads as something a person could type
// or edit by hand, such as "?trust=needs-review&vendor=Acme". Every value is
// a plain string; a route's own search parsing turns those back into lists,
// numbers, or whatever it needs.
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function parseSearch(searchStr: string): Record<string, string> {
  const params = new URLSearchParams(searchStr);
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    out[key] = value;
  }
  return out;
}
