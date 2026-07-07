import { contextBridge } from 'electron';

// The preload runs in an isolated context and is the ONLY bridge between the
// trusted main process and the untrusted renderer. Keep this surface minimal —
// any new capability exposed here is reachable by renderer code.
contextBridge.exposeInMainWorld('narratox', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
