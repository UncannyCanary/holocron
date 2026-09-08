import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { document, page } from '../db/schema.js';
// biome-ignore lint/style/useImportType: Nest reads this at runtime to inject it; a type-only import breaks that.
import { JobsService } from '../jobs/jobs.module.js';
import { buildPages } from '../pages/pages.js';
import { dataPath, samplesPath } from '../paths.js';

const SAMPLE_TYPES = {
  invoices: 'invoice',
  receipts: 'receipt',
  contracts: 'contract',
} as const;

const SAMPLE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

// Turns the sample files mounted read-only from samples/ into the shared,
// canonical document rows every workspace copies from. Runs once, at API
// startup, and does nothing on later restarts once a sample is already a row.
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.PROCESS_ROLE === 'worker' || process.env.NODE_ENV === 'test') {
      return;
    }
    await this.seedAll();
  }

  async seedAll(): Promise<void> {
    for (const [folder, type] of Object.entries(SAMPLE_TYPES)) {
      const dir = samplesPath(folder);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        this.logger.warn(`No samples found at ${dir}`);
        continue;
      }

      for (const name of names.sort()) {
        if (!SAMPLE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
        await this.seedOne(path.join(dir, name), type);
      }
    }

    await this.queueUnread();
  }

  // Every shared sample that has not been read yet goes on the queue. A
  // sample is read once and its fields and checks are copied into each new
  // workspace, so this does nothing on a restart once they are ready. A
  // sample parked by the spending cap is picked up again next time.
  private async queueUnread(): Promise<void> {
    const waiting = await this.db
      .select({ id: document.id })
      .from(document)
      .where(and(isNull(document.workspaceId), eq(document.status, 'queued')));

    for (const doc of waiting) {
      await this.jobs.sendProcessDocument({ documentId: doc.id, workspaceId: null });
    }
    if (waiting.length > 0) {
      this.logger.log(`Queued ${waiting.length} sample(s) to be read.`);
    }
  }

  private async seedOne(filePath: string, type: (typeof SAMPLE_TYPES)[keyof typeof SAMPLE_TYPES]) {
    const [existing] = await this.db
      .select({ id: document.id })
      .from(document)
      .where(and(isNull(document.workspaceId), eq(document.filePath, filePath)));
    if (existing) return;

    const [doc] = await this.db
      .insert(document)
      .values({ type, filePath, status: 'queued' })
      .returning();

    const outDir = dataPath('pages', doc.id);
    const pages = await buildPages(filePath, outDir);

    for (const built of pages) {
      await this.db.insert(page).values({
        documentId: doc.id,
        number: built.number,
        imagePath: built.imagePath,
        widthPx: built.widthPx,
        heightPx: built.heightPx,
        widthPt: built.widthPt,
        heightPt: built.heightPt,
        textLayer: built.textLayer,
      });
    }

    this.logger.log(`Seeded ${path.basename(filePath)} as a ${type} (${pages.length} page(s)).`);
  }
}
