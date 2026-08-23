import { defineConfig } from 'vite';
import { nodeExternals, nativeExternals, sharedAliases } from './vite.base.config';

/**
 * The import worker runs inside an Electron `utilityProcess`. It is built as a
 * separate CommonJS bundle so it can be forked from disk at runtime.
 */
export default defineConfig({
  resolve: {
    alias: sharedAliases,
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    target: 'node20',
    minify: false,
    sourcemap: true,
    emptyOutDir: false,
    rollupOptions: {
      external: [...nodeExternals, ...nativeExternals],
      output: { format: 'cjs', entryFileNames: '[name].cjs' },
    },
  },
});
