import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Environmental safety check: prevent tests from executing in production
if (process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: Tests are strictly forbidden from running in NODE_ENV=production!');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/test/**', '**/*.d.ts', '**/*.config.*']
    }
  },
  resolve: {
    alias: {
      '@proofmesh/contracts': path.resolve(__dirname, 'packages/contracts/src'),
      '@proofmesh/domain': path.resolve(__dirname, 'packages/domain/src'),
      '@proofmesh/db': path.resolve(__dirname, 'packages/db/src'),
      '@proofmesh/sdk': path.resolve(__dirname, 'packages/sdk/src'),
      '@proofmesh/mcp-server': path.resolve(__dirname, 'packages/mcp-server/src')
    }
  }
});
