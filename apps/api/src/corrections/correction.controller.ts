import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { workspaceIdFromCookieHeader } from '../cookie/workspace-cookie.js';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { check, correction, document, field } from '../db/schema.js';
import { applyChecks } from '../pipeline/apply-checks.js';
import { NO_WORKSPACE_MESSAGE } from '../workspace/workspace.controller.js';

const NO_SUCH_FIELD = 'There is no such field.';
const NEEDS_A_VALUE = 'Type the value you want to save.';

@Controller('fields')
export class CorrectionController {
  private readonly logger = new Logger(CorrectionController.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  // A person changing a value. The new value is saved with the old one, the
  // field becomes corrected, and every check on the document runs again
  // against it. The checks whose answer turned around are written on the
  // correction. Nothing here goes back to the model.
  @Post(':id/correction')
  async correct(@Req() req: Request, @Param('id') fieldId: string, @Body('value') value: unknown) {
    const workspaceId = workspaceIdFromCookieHeader(req.headers.cookie);
    if (workspaceId === null) {
      throw new HttpException(NO_WORKSPACE_MESSAGE, HttpStatus.NOT_FOUND);
    }
    if (typeof value !== 'string') {
      throw new HttpException(NEEDS_A_VALUE, HttpStatus.BAD_REQUEST);
    }

    const [row] = await this.db
      .select({ field, document })
      .from(field)
      .innerJoin(document, eq(field.documentId, document.id))
      .where(eq(field.id, fieldId));

    // A field in someone else's workspace reads the same as one that is not
    // there at all.
    if (!row || row.document.workspaceId !== workspaceId) {
      throw new HttpException(NO_SUCH_FIELD, HttpStatus.NOT_FOUND);
    }

    const documentId = row.document.id;
    const before = await this.db.select().from(check).where(eq(check.documentId, documentId));

    const [saved] = await this.db
      .insert(correction)
      .values({ fieldId, oldValue: row.field.value, newValue: value })
      .returning();

    // The box is kept, so the reviewer can still see where the value came
    // from even though the value is now theirs.
    await this.db.update(field).set({ value, trust: 'corrected' }).where(eq(field.id, fieldId));

    const results = await applyChecks(this.db, documentId);

    const was = new Map(before.map((each) => [each.name, each.passed]));
    const now = new Map(results.map((each) => [each.name, each.passed]));
    const changed = [...new Set([...was.keys(), ...now.keys()])]
      .filter((name) => was.get(name) !== now.get(name))
      .sort();

    await this.db
      .update(correction)
      .set({ changedChecks: changed })
      .where(eq(correction.id, saved.id));

    this.logger.log(
      `Corrected ${row.field.name} on document ${documentId}. ` +
        (changed.length === 0 ? 'No check changed.' : `Checks changed: ${changed.join(', ')}.`),
    );

    return {
      fields: await this.db.select().from(field).where(eq(field.documentId, documentId)),
      checks: await this.db.select().from(check).where(eq(check.documentId, documentId)),
      changedChecks: changed,
    };
  }
}
