import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    // The React Compiler memoises components and hooks on its own, so nothing
    // here needs useMemo or useCallback by hand.
    react({ compiler: true }),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
