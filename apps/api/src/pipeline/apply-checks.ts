import { eq, inArray } from 'drizzle-orm';
import { type CheckFields, type CheckResult, runChecks } from '../checks/checks.js';
import { trustOfFields } from '../checks/trust.js';
import type { Db } from '../db/client.js';
import { check, correction, document, field } from '../db/schema.js';

// Runs every check the document type has against the values we hold right
// now, writes the answers, and works out the trust state of every field from
// them. It is the same code after a correction as after an extraction, so a
// corrected document is judged exactly the way a fresh one is.
export async function applyChecks(db: Db, documentId: string): Promise<CheckResult[]> {
  const [doc] = await db.select().from(document).where(eq(document.id, documentId));
  if (!doc) {
    throw new Error(`There is no document ${documentId} to check.`);
  }

  const fields = await db.select().from(field).where(eq(field.documentId, documentId));

  // Which fields a person has changed. A corrected field stays corrected
  // whatever the checks say.
  const corrected = new Set<string>();
  if (fields.length > 0) {
    const rows = await db
      .select({ fieldId: correction.fieldId })
      .from(correction)
      .where(
        inArray(
          correction.fieldId,
          fields.map((row) => row.id),
        ),
      );
    for (const row of rows) {
      corrected.add(row.fieldId);
    }
  }

  const values: CheckFields = {};
  for (const row of fields) {
    values[row.name] = { value: row.value, currency: row.currency };
  }

  const results = runChecks(doc.type, values);

  // A check names the fields it blames and flags; the rows hold their ids.
  const idByName = new Map(fields.map((row) => [row.name, row.id]));
  const idsOf = (names: string[]) =>
    names.map((name) => idByName.get(name)).filter((id): id is string => id !== undefined);

  await db.delete(check).where(eq(check.documentId, documentId));
  if (results.length > 0) {
    await db.insert(check).values(
      results.map((result) => ({
        documentId,
        name: result.name,
        passed: result.passed,
        message: result.message,
        blamedFieldIds: idsOf(result.blamed),
        flaggedFieldIds: idsOf(result.flagged),
      })),
    );
  }

  const verdicts = trustOfFields(
    fields.map((row) => ({
      name: row.name,
      corrected: corrected.has(row.id),
      // A field with a box is one whose value was found on the page.
      grounded: row.x0 !== null,
      // Null means the document itself never printed this value.
      onDocument: row.value !== null,
    })),
    results,
  );

  for (const verdict of verdicts) {
    const id = idByName.get(verdict.name);
    if (id !== undefined) {
      await db.update(field).set({ trust: verdict.trust }).where(eq(field.id, id));
    }
  }

  return results;
}
