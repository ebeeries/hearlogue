import { defineConfig } from 'vite';
import { nodeExternals, sharedAliases } from './vite.base.config';

export default defineConfig({
  resolve: { alias: sharedAliases },
  build: {
    target: 'node20',
    minify: false,
    sourcemap: 'inline',
    emptyOutDir: false,
    rollupOptions: {
      external: nodeExternals,
      output: { format: 'cjs', entryFileNames: '[name].js' },
    },
  },
});
