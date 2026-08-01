/**
 * Optional Electron shell so the editor runs as a desktop app on macOS
 * (and Windows/Linux) instead of a browser tab.
 *
 * It is deliberately *not* an npm workspace: Electron is a ~150 MB download
 * and nobody working on the game itself needs it. See docs/EDITOR.md.
 *
 *   npm run build && npm run start -w takeon-web   # serve the app
 *   cd desktop && npm install && npm start         # open the window
 */
const { app, BrowserWindow, shell } = require('electron');

const URL = process.env.TAKEON_EDITOR_URL || 'http://127.0.0.1:3400/editor';

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#120e2e',
    title: 'TakeOn Editor',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Retry: the dev server is often still booting when the window opens.
  const load = (attempt = 0) => {
    win.loadURL(URL).catch(() => {
      if (attempt > 40) {
        win.loadURL(
          `data:text/html,${encodeURIComponent(
            `<body style="font-family:system-ui;background:#120e2e;color:#e8e6f5;padding:40px">
               <h2>Nothing serving ${URL}</h2>
               <p>Start the app first: <code>npm run build &amp;&amp; npm run start -w takeon-web</code></p>
             </body>`,
          )}`,
        );
        return;
      }
      setTimeout(() => load(attempt + 1), 500);
    });
  };
  load();

  // External links open in the real browser, not inside the editor window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
