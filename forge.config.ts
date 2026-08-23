import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'HEARLOGUE',
    executableName: 'HEARLOGUE',
    appBundleId: 'app.hearlogue.desktop',
    appCategoryType: 'public.app-category.music',
    asar: true,
    icon: './assets/icon',
    win32metadata: {
      CompanyName: 'HEARLOGUE',
      ProductName: 'HEARLOGUE',
      FileDescription: 'Your past is still playing.',
    },
    /**
     * Only build output, the icon and package.json need to ship. Forge's Vite
     * plugin would apply its own default here, but this list is explicit so it
     * is obvious what does and does not reach a user's machine.
     */
    ignore: [
      /^\/src/,
      /^\/tests/,
      /^\/docs/,
      /^\/scripts/,
      // The landing page is deployed to GitHub Pages, not shipped in the app.
      /^\/site/,
      /^\/\.vscode/,
      /^\/\.github/,
      /^\/\.gitignore$/,
      /^\/\.prettierrc\.json$/,
      /^\/README\.md$/,
      /(.eslintrc|eslint\.config)/,
      /^\/tsconfig/,
      /^\/vite\..*\.ts$/,
      /^\/forge\.config\.ts$/,
      /^\/playwright\.config\.ts$/,
      /^\/vitest\.config\.ts$/,
      /^\/tailwind\.config/,
      /^\/postcss\.config/,
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'HEARLOGUE',
      setupExe: 'HEARLOGUE-Setup.exe',
      noMsi: true,
      setupIcon: './assets/icon.ico',
    }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/import/workers/import-worker.ts',
          config: 'vite.worker.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
