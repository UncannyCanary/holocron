import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { createDb } from '../src/db/client.js';

process.env.ACCESS_CODE = 'letmein';
process.env.COOKIE_SECRET ??= 'test-cookie-secret';
// The same local Compose database the unit tests fall back to, so this runs
// with plain `pnpm test:e2e` and no .env wired in.
process.env.DATABASE_URL ??= 'postgres://holocron:holocron@localhost:5432/holocron_test';

describe('a fresh browser at the door', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const db = createDb(
      process.env.DATABASE_URL ?? 'postgres://holocron:holocron@localhost:5432/holocron_test',
    );
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.$client.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    // Lets tests tell requests apart by X-Forwarded-For, the same as main.ts
    // does for the real deploy behind Caddy.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks every route except the door and health while locked', async () => {
    const server = app.getHttpServer();
    const res = await request(server).get('/api/workspace').set('X-Forwarded-For', '198.51.100.1');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Enter the access code to continue.');

    expect((await request(server).get('/api/health')).status).toBe(200);
  });

  it('locks the address out after 5 wrong codes', async () => {
    const server = app.getHttpServer();
    const ip = '198.51.100.2';

    for (let i = 0; i < 4; i += 1) {
      const res = await request(server)
        .post('/api/door')
        .set('X-Forwarded-For', ip)
        .send({ code: 'wrong' });
      expect(res.status).toBe(401);
    }

    // The 5th wrong guess is the one that trips the lockout.
    const locked = await request(server)
      .post('/api/door')
      .set('X-Forwarded-For', ip)
      .send({ code: 'wrong' });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toContain('Wait 15 minutes');

    // Locked out even with the right code now.
    const stillLocked = await request(server)
      .post('/api/door')
      .set('X-Forwarded-For', ip)
      .send({ code: 'letmein' });
    expect(stillLocked.status).toBe(429);
  });

  it('passes the door and gets a workspace', async () => {
    const server = app.getHttpServer();
    const ip = '198.51.100.3';

    const unlock = await request(server)
      .post('/api/door')
      .set('X-Forwarded-For', ip)
      .send({ code: 'letmein' });
    expect(unlock.status).toBe(200);
    expect(unlock.body).toEqual({ unlocked: true });
    const doorCookie = unlock.headers['set-cookie'];
    expect(doorCookie).toBeTruthy();

    // Unlocked but no workspace yet: nothing was created just by asking.
    const before = await request(server)
      .get('/api/workspace')
      .set('X-Forwarded-For', ip)
      .set('Cookie', doorCookie);
    expect(before.status).toBe(404);

    const created = await request(server)
      .post('/api/workspace')
      .set('X-Forwarded-For', ip)
      .set('Cookie', doorCookie);
    expect(created.status).toBe(200);
    expect(created.body.id).toBeTruthy();
    const workspaceCookie = created.headers['set-cookie'];

    const fetched = await request(server)
      .get('/api/workspace')
      .set('X-Forwarded-For', ip)
      .set('Cookie', workspaceCookie);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(created.body.id);

    // Asking again reuses the same workspace instead of making another.
    const again = await request(server)
      .post('/api/workspace')
      .set('X-Forwarded-For', ip)
      .set('Cookie', workspaceCookie);
    expect(again.body.id).toBe(created.body.id);
  });

  it('limits new workspaces to 3 an hour per address', async () => {
    const server = app.getHttpServer();
    const ip = '198.51.100.4';

    const unlock = await request(server)
      .post('/api/door')
      .set('X-Forwarded-For', ip)
      .send({ code: 'letmein' });
    const doorCookie = unlock.headers['set-cookie'];

    // No workspace cookie is sent back on any of these, so each is a fresh
    // creation attempt from the same address.
    for (let i = 0; i < 3; i += 1) {
      const res = await request(server)
        .post('/api/workspace')
        .set('X-Forwarded-For', ip)
        .set('Cookie', doorCookie);
      expect(res.status).toBe(200);
    }

    const fourth = await request(server)
      .post('/api/workspace')
      .set('X-Forwarded-For', ip)
      .set('Cookie', doorCookie);
    expect(fourth.status).toBe(429);
    expect(fourth.body.message).toBe(
      'Too many new workspaces from this address. Wait an hour and try again.',
    );
  });
});
