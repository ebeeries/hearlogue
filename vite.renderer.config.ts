import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sharedAliases } from './vite.base.config';

export default defineConfig({
  // index.html lives with the renderer sources rather than at the repository
  // root, so `root` is moved here.
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  resolve: { alias: sharedAliases },
  build: {
    /**
     * Forge asks for the relative path `.vite/renderer/main_window`, which Vite
     * would resolve against `root` above and bury inside the source tree. An
     * absolute path pins the bundle where the main process expects to find it.
     */
    outDir: path.resolve(process.cwd(), '.vite/renderer/main_window'),
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
  clearScreen: false,
});
