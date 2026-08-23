import { builtinModules } from 'node:module';
import path from 'node:path';

/** Node built-ins plus their `node:` prefixed forms — never bundle these. */
export const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  'electron',
];

/** Native modules that must stay in node_modules and be loaded at runtime. */
export const nativeExternals = ['better-sqlite3'];

export const sharedAliases = {
  '@shared': path.resolve(process.cwd(), 'src/shared'),
  '@main': path.resolve(process.cwd(), 'src/main'),
  '@renderer': path.resolve(process.cwd(), 'src/renderer'),
  '@preload': path.resolve(process.cwd(), 'src/preload'),
};
