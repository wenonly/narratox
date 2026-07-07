import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

// Injected by @electron-forge/plugin-vite at dev-time. Key name is derived from
// the renderer's `name` in forge.config.ts (main_window → MAIN_WINDOW_VITE_*).
// @see node_modules/@electron-forge/plugin-vite/dist/config/vite.base.config.js#getDefineKeys
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Narratox',
    backgroundColor: '#111113',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open external http(s) links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Avoid a white flash: only reveal the window once it has painted.
  win.once('ready-to-show', () => win.show());

  const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  if (isDev) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // 默认开 DevTools,方便调试;Cmd+W 关掉即可。
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS: apps stay active until quit explicitly.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
