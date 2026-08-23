import { defineConfig } from 'vite';
import { nodeExternals, nativeExternals, sharedAliases } from './vite.base.config';

export default defineConfig({
  resolve: {
    alias: sharedAliases,
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    target: 'node20',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [...nodeExternals, ...nativeExternals],
      output: { format: 'es', entryFileNames: '[name].js' },
    },
  },
});
