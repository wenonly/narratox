import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';

// Injected by @electron-forge/plugin-vite at dev-time. Key name is derived from
// the renderer's `name` in forge.config.ts (main_window → MAIN_WINDOW_VITE_*).
// @see node_modules/@electron-forge/plugin-vite/dist/config/vite.base.config.js#getDefineKeys
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 440,
    height: 780,
    minWidth: 440,
    minHeight: 780,
    resizable: false,
    maximizable: false,
    title: 'Narratox · 登录',
    backgroundColor: '#1A1A22',
    show: false,
    autoHideMenuBar: true,
    // Mac:走系统 traffic lights(hiddenInset 保留三色灯);Windows/Linux:完全 frameless,
    // 自画 min/max/close(镜像 Pencil PmHVI WinTitlebar)。
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    frame: isMac ? true : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Titlebar 窗控来自 preload → ipcRenderer.send('window-action', ...)
  ipcMain.handle('window-action', (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      // resizable:false 下不能真最大化;后续若启用 resizable,改成 win.isMaximized() ? win.unmaximize() : win.maximize()
    } else if (action === 'close') win.close();
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

  const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
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
