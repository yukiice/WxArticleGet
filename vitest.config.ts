import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@wx/shared/node', replacement: path.resolve(__dirname, 'packages/shared/src/node.ts') },
      ...['shared', 'db', 'queue', 'wechat', 'email'].map((name) => ({
        find: new RegExp(`^@wx/${name}$`), replacement: path.resolve(__dirname, `packages/${name}/src/index.ts`),
      })),
    ],
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'] },
});
