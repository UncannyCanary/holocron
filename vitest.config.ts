import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Tests that touch the database use their own, and it is migrated once
    // before any spec file starts, so a fresh database never sees several
    // files running the migrations at the same moment.
    env: { DATABASE_URL: 'postgres://holocron:holocron@localhost:5432/holocron_test' },
    globalSetup: ['./apps/api/test/global-setup.ts'],
    include: ['{apps,packages}/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
