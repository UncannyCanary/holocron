import { z } from 'zod';

// A box on a page. All four numbers run from 0 to 1, origin top left,
// measured against the rendered page image. Storing them this way means a
// box still fits after the page is re-rendered at a different size.
export const boxSchema = z.object({
  x0: z.number().min(0).max(1),
  y0: z.number().min(0).max(1),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
});

export type Box = z.infer<typeof boxSchema>;

// Where a page's words came from. A page has a text layer of its own, or we
// read it with OCR. Never the model: the model's own coordinates are guesses,
// so they can never be the evidence that a value is really on the page.
export const textLayerSourceSchema = z.enum(['pdf-text', 'ocr-tesseract']);

export type TextLayerSource = z.infer<typeof textLayerSourceSchema>;

// One word on the page, with the box it sits in. OCR gives a confidence from
// 0 to 100 for each word. A PDF text layer gives none, so it is null.
export const spanSchema = z.object({
  text: z.string(),
  box: boxSchema,
  confidence: z.number().min(0).max(100).nullable(),
});

export type Span = z.infer<typeof spanSchema>;

// Every word on one page, in the order we read them.
export const pageTextLayerSchema = z.object({
  source: textLayerSourceSchema,
  spans: z.array(spanSchema),
});

export type PageTextLayer = z.infer<typeof pageTextLayerSchema>;
