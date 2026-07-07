import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Narratox',
    executableName: 'Narratox',
    asar: true,
  },
  makers: [
    // Windows installer (.exe / Squirrel.Auto)
    new MakerSquirrel({}),
    // Cross-platform zip snapshot (no installer) — handy for dev builds.
    new MakerZIP({}, ['darwin', 'linux']),
    // macOS disk image.
    new MakerDMG({}, ['darwin']),
    // Linux Debian package.
    new MakerDeb({}, ['linux']),
  ],
  plugins: [
    new VitePlugin({
      // main + preload are bundled separately from the renderer.
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
  ],
};

export default config;
