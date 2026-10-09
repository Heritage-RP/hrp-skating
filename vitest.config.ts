import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: {
    alias: { '@common': resolve(__dirname, 'src/common'), '~': resolve(__dirname, '.') },
  },
});
