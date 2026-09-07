import { Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

export const PG_BOSS = Symbol('PG_BOSS');

@Injectable()
class PgBossShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true, timeout: 45_000 });
  }
}

@Module({
  providers: [
    {
      provide: PG_BOSS,
      useFactory: async (): Promise<PgBoss> => {
        const boss = new PgBoss({
          connectionString: process.env.DATABASE_URL,
          application_name: process.env.PROCESS_ROLE ?? 'holocron',
          useListenNotify: process.env.PROCESS_ROLE === 'worker',
        });
        boss.on('error', (err: Error) => Logger.error(err, 'pg-boss'));
        boss.on('warning', (w: { message: string }) => Logger.warn(w.message, 'pg-boss'));
        await boss.start();
        return boss;
      },
    },
    PgBossShutdown,
  ],
  exports: [PG_BOSS],
})
export class JobsModule {}
