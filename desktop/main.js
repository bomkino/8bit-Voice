// 8-bit Voice as a desktop app: the same page as ../index.html in its own
// window. Nothing here talks to the network; every sound is made on the page.
const { app, BrowserWindow, Menu, nativeTheme, session, shell } = require('electron');
const path = require('node:path');

const PAGE = app.isPackaged
  ? path.join(__dirname, 'web', 'index.html')
  : path.join(__dirname, '..', 'index.html');
const groundColor = () => (nativeTheme.shouldUseDarkColors ? '#0c0d12' : '#e3e0d9');

let win = null;

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: '8-bit Voice',
    backgroundColor: groundColor(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // Links leave for the browser; the window only ever shows the tool.
  const external = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return;
    e.preventDefault();
    external(url);
  });

  // The page hides its "get the app" parts when it knows it's inside one.
  win.loadFile(PAGE, { query: { shell: 'desktop' } });
}

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  // Menu items press the page's own buttons, so the app and the website
  // can never drift apart.
  const press = (id) => () => {
    if (!win) return;
    win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`, true).catch(() => {});
  };
  const open = (url) => () => shell.openExternal(url);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Lines…', accelerator: 'CmdOrCtrl+O', click: press('openTxt') },
        { type: 'separator' },
        { label: 'Save This Line…', accelerator: 'CmdOrCtrl+S', click: press('dlOne') },
        { label: 'Save All Lines…', accelerator: 'CmdOrCtrl+Shift+S', click: press('dlAll') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Voice',
      submenu: [
        { label: 'Play or Stop', accelerator: 'CmdOrCtrl+Return', click: press('play') },
        { label: 'Hear All Six Machines', accelerator: 'CmdOrCtrl+Shift+Return', click: press('hearAll') },
        { label: 'New Take', accelerator: 'CmdOrCtrl+T', click: press('newTake') },
        { label: 'Speakerphone On or Off', click: press('phone') },
      ],
    },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: '8-bit Voice on the Web', click: open('https://bomkino.github.io/8bit-Voice/') },
        { label: 'Source Code', click: open('https://github.com/bomkino/8bit-Voice') },
        { label: 'Report a Problem', click: open('https://github.com/bomkino/8bit-Voice/issues/new') },
        { label: 'Check for a New Version', click: open('https://github.com/bomkino/8bit-Voice/releases/latest') },
      ],
    },
  ]));
  app.setAboutPanelOptions({
    applicationName: '8-bit Voice',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 pitch.dog · MIT License',
    credits: 'Every sound is synthesized on the spot. No samples, nothing to license.',
    website: 'https://bomkino.github.io/8bit-Voice/',
  });

  // The page's downloads (one WAV, or a zip of every line) ask where to save,
  // starting in Downloads with the name the tool picked.
  session.defaultSession.on('will-download', (_e, item) => {
    const name = item.getFilename();
    const zip = name.toLowerCase().endsWith('.zip');
    item.setSaveDialogOptions({
      title: zip ? 'Save all clips' : 'Save clip',
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [zip ? { name: 'Zip archive', extensions: ['zip'] } : { name: 'WAV audio', extensions: ['wav'] }],
    });
  });

  nativeTheme.on('updated', () => { if (win) win.setBackgroundColor(groundColor()); });
  createWindow();
});

app.on('second-instance', () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => app.quit());
