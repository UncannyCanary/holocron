import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// A document is an invoice, a receipt, or a contract.
export const documentType = pgEnum('document_type', ['invoice', 'receipt', 'contract']);

// A document moves through these four states as the worker processes it.
export const documentStatus = pgEnum('document_status', [
  'queued',
  'processing',
  'ready',
  'failed',
]);

// The four trust states a field can show on its badge.
export const fieldTrust = pgEnum('field_trust', [
  'verified',
  'unverifiable',
  'contradicted',
  'corrected',
]);

// The steps a run passes through, in order, ending in done or failed.
export const runStepName = pgEnum('run_step_name', [
  'received',
  'rendered',
  'text_layer',
  'split',
  'extracted',
  'grounded',
  'checked',
  'done',
  'failed',
]);

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  reopenSecret: text('reopen_secret').notNull().unique(),
});

export type Workspace = typeof workspace.$inferSelect;

// One uploaded file, or one shared sample. Samples are stored once: their
// canonical row has a null workspaceId. A workspace's copy of a sample sets
// workspaceId to that workspace and documentId back to the canonical row, so
// pages and runs stay shared while fields and checks are the workspace's own.
//
// One file can hold more than one document, such as two invoices from two
// sellers in one order. The uploaded row is the first of them and owns the
// pages. Each further document is its own row with sourceId pointing back at
// the uploaded row, and pageNumbers says which of the file's pages are its.
// A row with null pageNumbers has every page of its file.
export const document = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').references((): AnyPgColumn => document.id, {
    onDelete: 'cascade',
  }),
  sourceId: uuid('source_id').references((): AnyPgColumn => document.id, {
    onDelete: 'cascade',
  }),
  pageNumbers: integer('page_numbers').array(),
  type: documentType('type').notNull(),
  status: documentStatus('status').notNull().default('queued'),
  filePath: text('file_path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One page of a document: its rendered image and its text layer, every word
// with its box from 0 to 1, origin top left. Belongs to the canonical
// document row, so a sample's pages are never copied per workspace.
export const page = pgTable('page', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => document.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  imagePath: text('image_path').notNull(),
  widthPx: integer('width_px').notNull(),
  heightPx: integer('height_px').notNull(),
  widthPt: real('width_pt').notNull(),
  heightPt: real('height_pt').notNull(),
  textLayer: jsonb('text_layer').notNull(),
});

// One extracted value. Belongs to a workspace's own document row, since
// corrections are per workspace. The box is the page plus x0, y0, x1, y1
// from 0 to 1, origin top left, or all null when the field is unverifiable.
export const field = pgTable('field', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => document.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  value: text('value'),
  // The currency of a money value, such as USD. Null on everything else. It
  // is kept here beside the value because the one currency check has nothing
  // to compare without it.
  currency: text('currency'),
  pageId: uuid('page_id').references(() => page.id, { onDelete: 'set null' }),
  x0: real('x0'),
  y0: real('y0'),
  x1: real('x1'),
  y1: real('y1'),
  quote: text('quote'),
  trust: fieldTrust('trust').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One rule from the check list, run against one document. Belongs to a
// workspace's own document row, since checks are re-run after a correction.
export const check = pgTable('check', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => document.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  passed: boolean('passed').notNull(),
  message: text('message').notNull(),
  blamedFieldIds: uuid('blamed_field_ids').array().notNull().default(sql`'{}'::uuid[]`),
  flaggedFieldIds: uuid('flagged_field_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A person changing a field. Keeps the old value, the new value, when, and
// the names of the checks whose answer the change turned around.
export const correction = pgTable('correction', {
  id: uuid('id').primaryKey().defaultRandom(),
  fieldId: uuid('field_id')
    .notNull()
    .references(() => field.id, { onDelete: 'cascade' }),
  oldValue: text('old_value'),
  newValue: text('new_value').notNull(),
  changedChecks: text('changed_checks').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One attempt at processing a document: timings, model used, token counts,
// errors. Belongs to the canonical document row, since a sample's run is
// shared rather than repeated per workspace.
export const run = pgTable('run', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => document.id, { onDelete: 'cascade' }),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

// One step of a run's timeline: start, end, and any error.
export const runStep = pgTable('run_step', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => run.id, { onDelete: 'cascade' }),
  name: runStepName('name').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  error: text('error'),
});
