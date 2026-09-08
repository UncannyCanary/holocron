import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db } from './client.js';

export const DB = Symbol('DB');
export type { Db };

@Injectable()
class DbShutdown implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}

@Module({
  providers: [{ provide: DB, useFactory: (): Db => createDb() }, DbShutdown],
  exports: [DB],
})
export class DbModule {}
