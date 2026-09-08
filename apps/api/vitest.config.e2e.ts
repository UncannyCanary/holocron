import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // The tests' own database, never the one the app runs against, so a
    // test run leaves nothing behind for a real workspace to pick up.
    env: { DATABASE_URL: 'postgres://holocron:holocron@localhost:5432/holocron_test' },
    globalSetup: ['./test/global-setup.ts'],
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
