import type Anthropic from '@anthropic-ai/sdk';
import type { DocumentType, PageTextLayer } from '@holocron/shared';
import { textLayerToText } from './page-text.js';

// One page, ready to send: the picture we rendered and the words we read off
// it. The model gets both, in that order, the way the vision guide asks.
export type ExtractPage = {
  number: number;
  image: Buffer;
  textLayer: PageTextLayer;
};

// The rules are the same for every document type, so this text never changes
// between calls. That keeps it worth caching and keeps the model's quotes
// matchable against our text layer.
const SHARED_RULES = [
  'You read bookkeeping documents and pull out the values a bookkeeper needs.',
  '',
  'Each page comes as a picture followed by the words we read off that page.',
  'Read both. The words are the part we can check, so a quote is copied from them.',
  '',
  'For every value give three things:',
  '- value: the value itself. Amounts are plain numbers, with no currency sign and no thousands separator. Dates are written YYYY-MM-DD.',
  '- page: the page number you read it from, counting from 1.',
  '- quote: the words as they are printed on that page, copied exactly.',
  '',
  'Rules for a quote:',
  '- Copy it word for word from the words of that page. Do not reword it, tidy it, or change its spacing.',
  '- Quote the value and nothing else. Leave out the label in front of it and every other word on the line. If the page says "Issued 3 Mar 2026", quote "3 Mar 2026". If it says "No. 1042", quote "1042". If it says "Total USD 181.50", quote "181.50".',
  '- Quote the value where it is printed, not somewhere it is added up or worked out.',
  '',
  'When a value is not there:',
  '- The document does not say it at all: put null in value, page and quote.',
  '- You can read it in the picture but it is not in the words of that page: give the value, and put null in page and quote. A value we cannot check is still worth having.',
  '- Never guess a value, and never work one out yourself. A missing value is a fine answer. An invented one is not.',
  '- In a list, give only the lines you can really read. A short list is better than empty rows.',
].join('\n');

const TYPE_RULES: Record<DocumentType, string> = {
  invoice: [
    'This document is an invoice.',
    "List every line on it, in the order they are printed. A line total is the figure in that line's own total column.",
    'A discount is a positive number. Leave it null when none is printed.',
    'Taxes are listed one by one, as printed: SGST and CGST are two tax lines, VAT is one. Never add taxes together yourself. Give tax_amount only when the document prints one figure for the total tax.',
    'When a line prints its own discount, taxable value, or tax, give them on that line. When the document prints a taxable value or a round off for the whole, give those too.',
  ].join('\n'),
  receipt: [
    'This document is a shop receipt.',
    'List every item line, in the order they are printed.',
    'A receipt often prints no quantity and no unit price. Leave those null rather than working them out.',
    'Taxes are listed one by one, as printed. Give tax_amount only when the receipt prints one figure for the total tax.',
    'Cash and change are only the amounts the receipt prints as tendered and returned.',
  ].join('\n'),
  contract: [
    'This document is a contract.',
    'Parties are the ones named at the start. Signature parties are the ones named in the signature block at the end. List them separately, even when they are the same names.',
    'A defined term is a phrase the contract gives a meaning, such as Confidential Information. Give it twice: once where it is defined, and once at a later place the contract uses it. Both quotes are the term itself, not the sentence around it. Leave the use null when the contract never uses it again.',
  ].join('\n'),
};

export function systemPrompt(type: DocumentType): string {
  return `${SHARED_RULES}\n\n${TYPE_RULES[type]}`;
}

const FINAL_ASK: Record<DocumentType, string> = {
  invoice: 'Pull out the invoice.',
  receipt: 'Pull out the receipt.',
  contract: 'Pull out the contract.',
};

// The pages, each as a labelled picture then its words, and the ask last.
export function buildContent(
  type: DocumentType,
  pages: ExtractPage[],
): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [];

  for (const page of pages) {
    content.push({ type: 'text', text: `Page ${page.number}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: page.image.toString('base64') },
    });
    content.push({
      type: 'text',
      text: `Page ${page.number} words, as we read them:\n${textLayerToText(page.textLayer)}`,
    });
  }

  content.push({ type: 'text', text: FINAL_ASK[type] });
  return content;
}
