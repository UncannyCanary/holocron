import { z } from 'zod';

// What the model sends back for every value it finds. The value itself, the
// page it read it from, and the exact words it copied from that page's text
// layer. The quote is the whole point: grounding looks for those words in our
// own text layer, and a value whose quote is not there can never be verified.
// Every part is required so the model has to say null rather than leave a
// field out. A missing field would be a hole in the answer; a null is a plain
// "the document does not say".
const spot = {
  page: z.number().nullable().describe('The page number the value was read from, counting from 1.'),
  quote: z.string().nullable().describe('The exact words from that page, copied and not reworded.'),
};

export const textFieldSchema = z.object({ value: z.string().nullable(), ...spot });

export const numberFieldSchema = z.object({ value: z.number().nullable(), ...spot });

// Dates come back written the one way, so two dates can be put in order
// without guessing whether a document meant day first or month first.
export const dateFieldSchema = z.object({
  value: z.string().nullable().describe('The date written as YYYY-MM-DD.'),
  ...spot,
});

// An amount of money carries its own currency, because one of the checks asks
// whether every amount on the document is in the same currency.
export const moneyFieldSchema = z.object({
  value: z.number().nullable().describe('The amount as a number, with no currency sign.'),
  currency: z.string().nullable().describe('The three letter currency code, such as USD.'),
  ...spot,
});

export type TextField = z.infer<typeof textFieldSchema>;
export type NumberField = z.infer<typeof numberFieldSchema>;
export type DateField = z.infer<typeof dateFieldSchema>;
export type MoneyField = z.infer<typeof moneyFieldSchema>;

// One line on an invoice or a receipt. Quantity and unit price are often left
// off a shop receipt, so both can be null while the line total stands.
const lineItemSchema = z.object({
  description: textFieldSchema,
  quantity: numberFieldSchema,
  unit_price: moneyFieldSchema,
  line_total: moneyFieldSchema,
});

export const invoiceExtractionSchema = z.object({
  vendor: textFieldSchema.describe('Who sent the invoice.'),
  bill_to: textFieldSchema.describe('Who has to pay it.'),
  invoice_number: textFieldSchema,
  issue_date: dateFieldSchema,
  due_date: dateFieldSchema,
  subtotal: moneyFieldSchema,
  discount: moneyFieldSchema.describe('The discount as a positive amount, or null.'),
  tax_amount: moneyFieldSchema,
  total: moneyFieldSchema,
  line_items: z.array(lineItemSchema),
});

export const receiptExtractionSchema = z.object({
  merchant: textFieldSchema.describe('The shop or the seller.'),
  purchased_at: dateFieldSchema,
  subtotal: moneyFieldSchema,
  tax_amount: moneyFieldSchema,
  total: moneyFieldSchema,
  cash: moneyFieldSchema.describe('The cash handed over, or null.'),
  change: moneyFieldSchema.describe('The change given back, or null.'),
  line_items: z.array(lineItemSchema),
});

// A term the contract defines and then uses, such as Confidential Information.
// The quote on the term is where it is defined. The quote on the use is a
// later place the contract uses it, or null when it is never used again.
const definedTermSchema = z.object({
  term: textFieldSchema,
  use: textFieldSchema,
});

export const contractExtractionSchema = z.object({
  title: textFieldSchema,
  parties: z.array(textFieldSchema).describe('Every party named at the start of the contract.'),
  signature_parties: z
    .array(textFieldSchema)
    .describe('Every party named in the signature block at the end.'),
  effective_date: dateFieldSchema,
  start_date: dateFieldSchema,
  end_date: dateFieldSchema,
  governing_law: textFieldSchema.describe('The place whose law governs, such as Delaware.'),
  defined_terms: z.array(definedTermSchema),
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
export type ContractExtraction = z.infer<typeof contractExtractionSchema>;

// One schema per document type. The three types are the same three the
// document table names.
export const extractionSchemas = {
  invoice: invoiceExtractionSchema,
  receipt: receiptExtractionSchema,
  contract: contractExtractionSchema,
} as const;

export type DocumentType = keyof typeof extractionSchemas;

export type ExtractionOf<T extends DocumentType> = z.infer<(typeof extractionSchemas)[T]>;

export type Extraction = InvoiceExtraction | ReceiptExtraction | ContractExtraction;
