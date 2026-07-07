// Globals injected at dev-time by @electron-forge/plugin-vite. The key name is
// derived from the renderer's `name` field in forge.config.ts (main_window →
// MAIN_WINDOW_VITE_DEV_SERVER_URL). In production builds this is `undefined`
// and we fall back to the packaged file path.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

// Surface exposed by src/preload.ts via contextBridge.
interface NarratoxDashboard {
  platform: NodeJS.Platform;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

interface Window {
  narratox?: NarratoxDashboard;
}
