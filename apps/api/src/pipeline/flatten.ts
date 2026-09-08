import type { Extraction } from '@holocron/shared';

// The model answers with a nested object: one entry per value, a list for the
// lines and the parties. The rest of the pipeline wants a flat list of fields
// with a name each, because the checks read values by name and a field row
// holds one value.
//
// A name is the path through the extraction schema, with a number for each
// item of a list:
//
//   total, issue_date
//   line_items.0.line_total
//   parties.0
//   defined_terms.0.term

export type FlatField = {
  name: string;
  // The value as a field row holds it: plain text. A number is written
  // without padding, a date as YYYY-MM-DD.
  value: string | null;
  // Only money carries one.
  currency: string | null;
  page: number | null;
  quote: string | null;
};

// One value as the model sends it back.
type Leaf = {
  value: string | number | null;
  currency?: string | null;
  page: number | null;
  quote: string | null;
};

// Every value the model sends has a quote beside it, so a node with both is
// the end of the path. Everything else is a list or a group to walk into.
function isLeaf(node: unknown): node is Leaf {
  return (
    typeof node === 'object' &&
    node !== null &&
    !Array.isArray(node) &&
    'value' in node &&
    'quote' in node
  );
}

function valueText(value: string | number | null): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' ? String(value) : value;
}

function walk(name: string, node: unknown, found: FlatField[]): void {
  if (isLeaf(node)) {
    found.push({
      name,
      value: valueText(node.value),
      currency: node.currency ?? null,
      page: node.page,
      quote: node.quote,
    });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      walk(`${name}.${index}`, item, found);
    });
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      walk(name === '' ? key : `${name}.${key}`, child, found);
    }
  }
}

export function flattenExtraction(extraction: Extraction): FlatField[] {
  const found: FlatField[] = [];
  walk('', extraction, found);
  return found;
}
