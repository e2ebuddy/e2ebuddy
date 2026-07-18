import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  treeshake: true,
  external: ['@anthropic-ai/sdk', 'playwright'],
});
