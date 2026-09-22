import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one SQLite file; parallel workers deadlock on its
    // single writer.
    fileParallelism: false,
  },
});
