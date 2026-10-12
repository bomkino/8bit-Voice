// BleepBloop as a desktop app: the same page as ../index.html in its own
// window. Nothing here talks to the network; every sound is made on the page.
const { app, BrowserWindow, Menu, nativeTheme, screen, session, shell, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Until 1.2 the app was called 8-bit Voice. Its lines, characters, recordings
// and window place are in that folder, so it keeps using it under the new name.
if (app.getName() === 'BleepBloop') app.setPath('userData', path.join(app.getPath('appData'), '8-bit Voice'));

const PAGE = app.isPackaged
  ? path.join(__dirname, 'web', 'index.html')
  : path.join(__dirname, '..', 'index.html');
const groundColor = () => (nativeTheme.shouldUseDarkColors ? '#0c0d12' : '#e3e0d9');

let win = null;

// The window opens where it was left, at the size it was left, if that spot
// is still on a screen.
const STATE = path.join(app.getPath('userData'), 'window.json');
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return {};
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80
      && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
    return visible ? b : { width: b.width, height: b.height };
  } catch {
    return {};
  }
}
function saveBounds() {
  if (!win || win.isMinimized() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(STATE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {}
}

// Sparkle, on the Mac only: the same updater as pitch.dog's other Mac apps.
// The bridge and Sparkle.framework are added by build/after-pack.cjs; a build
// without them simply has no updater.
let updater = null;
function startUpdater() {
  if (process.platform !== 'darwin' || !app.isPackaged) return;
  try {
    const bridge = require(path.join(process.resourcesPath, 'sparkle.node'));
    if (bridge.start()) updater = bridge;
  } catch (err) {
    console.error('BleepBloop: no updater:', err.message);
  }
  // Release testing (docs/UPDATES.md): a copy told where to write says which
  // version is running, once it is up.
  const ready = systemPreferences.getUserDefault('UpdateTestReadyFile', 'string');
  if (ready) setTimeout(() => fs.writeFile(ready, `${app.getVersion()} ${process.pid}\n`, () => {}), 1000);
}

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const { maximized, ...bounds } = savedBounds();
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    ...bounds,
    minWidth: 380,
    minHeight: 560,
    title: 'BleepBloop',
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
  win.once('ready-to-show', () => {
    if (maximized) win.maximize();
    win.show();
  });
  win.on('close', saveBounds);
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
  startUpdater();
  const appMenu = updater
    ? {
        label: app.name,
        submenu: [
          { role: 'about' },
          { label: 'Check for Updates…', click: () => updater.check() },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }
    : { role: 'appMenu' };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [appMenu] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Lines…', accelerator: 'CmdOrCtrl+O', click: press('openTxt') },
        { type: 'separator' },
        { label: 'Save This Line…', accelerator: 'CmdOrCtrl+S', click: press('dlOne') },
        { label: 'Save All Lines…', accelerator: 'CmdOrCtrl+Shift+S', click: press('dlAll') },
        { label: 'Make a Video…', accelerator: 'CmdOrCtrl+E', click: press('makeVideo') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Voice',
      submenu: [
        { label: 'Play or Stop', accelerator: 'CmdOrCtrl+Return', click: press('play') },
        { label: 'Hear Every Machine', accelerator: 'CmdOrCtrl+Shift+Return', click: press('hearAll') },
        { label: 'New Take', accelerator: 'CmdOrCtrl+T', click: press('newTake') },
        { label: 'Speakerphone On or Off', click: press('phone') },
        { type: 'separator' },
        { label: 'Make a Character…', accelerator: 'CmdOrCtrl+Shift+N', click: press('makeOwn') },
        { label: 'Use Your Voice…', accelerator: 'CmdOrCtrl+Shift+R', click: press('useMic') },
      ],
    },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'BleepBloop on the Web', click: open('https://bomkino.github.io/8bit-Voice/') },
        { label: 'Source Code', click: open('https://github.com/bomkino/8bit-Voice') },
        { label: 'Report a Problem', click: open('https://github.com/bomkino/8bit-Voice/issues/new') },
        ...(updater ? [] : [{ label: 'Check for a New Version', click: open('https://github.com/bomkino/8bit-Voice/releases/latest') }]),
      ],
    },
  ]));
  app.setAboutPanelOptions({
    applicationName: 'BleepBloop',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 pitch.dog · MIT License',
    credits: 'Every sound is made on the spot, on your computer. No samples, no accounts, nothing sent anywhere.',
    website: 'https://bomkino.github.io/8bit-Voice/',
  });

  // The page's downloads (a WAV, a video, a picture, or a zip of several)
  // ask where to save, starting in Downloads with the name the tool picked.
  const KINDS = {
    wav: ['Save clip', 'WAV audio'],
    zip: ['Save all', 'Zip archive'],
    mp4: ['Save video', 'MP4 video'],
    webm: ['Save video', 'WebM video'],
    png: ['Save picture', 'PNG image'],
  };
  session.defaultSession.on('will-download', (_e, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).slice(1).toLowerCase();
    const [title, kind] = KINDS[ext] || ['Save', 'File'];
    item.setSaveDialogOptions({
      title,
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: kind, extensions: [ext || '*'] }],
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
