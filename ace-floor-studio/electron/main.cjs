// Ace Floor Studio — Electron main process.
// The whole app state (last Compass import + heatmap settings) is one
// JSON file in userData (floor.json). A rotating automatic backup is
// written on every quit, same safety net as the other Ace Studio apps.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = !!DEV_URL;

const SUPPORT_EMAIL = 'csuter@snydersace.net';
const VERSION_URL =
  'https://github.com/codysuter/codysuter/releases/download/ace-floor-studio-windows/version.txt';
const RELEASE_PAGE = 'https://github.com/codysuter/codysuter/releases/tag/ace-floor-studio-windows';
const AUTO_BACKUPS_KEPT = 15;

let mainWindow = null;

// Tests point this somewhere disposable so a smoke run never touches a
// real floor.json.
if (process.env.AFS_USER_DATA) app.setPath('userData', process.env.AFS_USER_DATA);

const docFile = () => path.join(app.getPath('userData'), 'floor.json');

function readDocSync() {
  try {
    return JSON.parse(fs.readFileSync(docFile(), 'utf8'));
  } catch {
    return null; // First run, or an unreadable file — the renderer seeds a fresh doc.
  }
}

ipcMain.handle('doc:load', async () => readDocSync());

ipcMain.handle('doc:save', async (_e, doc) => {
  if (!doc || doc.version !== 1 || typeof doc.settings !== 'object') throw new Error('Invalid doc');
  // Write-then-rename so a crash mid-write can't corrupt the only copy.
  const tmp = `${docFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
  await fsp.rename(tmp, docFile());
});

// ---- file dialogs (Compass import, JSON backup/restore) ----

const FILTERS = {
  import: [
    { name: 'Compass exports', extensions: ['csv', 'xlsx', 'xls'] },
    { name: 'All files', extensions: ['*'] },
  ],
  json: [{ name: 'JSON', extensions: ['json'] }],
};

ipcMain.handle('file:pick', async (_e, kind) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'import' ? 'Import a Compass export' : 'Restore from backup',
      filters: FILTERS[kind] || FILTERS.json,
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    const bytes = await fsp.readFile(filePaths[0]);
    return { ok: true, name: path.basename(filePaths[0]), bytes: bytes.toString('base64') };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('file:save', async (_e, { defaultName, text, kind }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save file',
      defaultPath: path.join(app.getPath('documents'), String(defaultName || 'export')),
      filters: kind === 'csv' ? [{ name: 'CSV spreadsheets', extensions: ['csv'] }] : FILTERS.json,
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, String(text), 'utf8');
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Rotating automatic backup of the doc on every quit, in userData/backups.
function autoBackup() {
  try {
    const doc = readDocSync();
    if (!doc) return;
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(dir, `auto-${stamp}.json`), JSON.stringify(doc, null, 2), 'utf8');
    const autos = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('auto-') && f.endsWith('.json'))
      .sort();
    for (const f of autos.slice(0, Math.max(0, autos.length - AUTO_BACKUPS_KEPT))) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    // Backups must never block quitting.
  }
}

// ---- support ----

function supportMailto(kind) {
  const label = kind === 'feature' ? 'Feature request' : 'Bug report';
  const subject = `Ace Floor Studio ${app.getVersion()} — ${label}`;
  const diag = `App version: ${app.getVersion()} · Windows ${os.release()}`;
  const body =
    kind === 'feature'
      ? `What should the app do?\n\n\nWhy it helps the store:\n\n\n${diag}`
      : `What happened?\n\n\nWhat did you expect?\n\n\nSteps to see it again:\n1. \n2. \n\n${diag}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

ipcMain.on('app:support', (_e, kind) => {
  void shell.openExternal(supportMailto(kind));
});

// ---- update check ----

function newerVersion(remote, local) {
  const pa = String(remote).trim().split('.').map(Number);
  const pb = String(local).trim().split('.').map(Number);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN) || pa.length === 0) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] || 0;
    const b = pb[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

// CI publishes version.txt next to the exe on every release.
async function fetchLatestVersion() {
  const res = await fetch(VERSION_URL, {
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function checkForUpdatesQuietly() {
  try {
    const latest = await fetchLatestVersion();
    if (newerVersion(latest, app.getVersion()) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update', latest);
    }
  } catch {
    // Offline or the release has no version.txt yet — stay quiet.
  }
}

async function checkForUpdatesInteractive() {
  try {
    const latest = await fetchLatestVersion();
    if (newerVersion(latest, app.getVersion())) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update available',
        message: `Version ${latest} is available — you have ${app.getVersion()}.`,
        detail: 'The download replaces AceFloorStudio.exe. Your imported data lives in its own folder and is untouched.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openExternal(RELEASE_PAGE);
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Up to date',
        message: `You're on the latest version (${app.getVersion()}).`,
      });
    }
  } catch {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Update check failed',
      message: "Couldn't reach the update server — check the internet connection and try again.",
    });
  }
}

// ---- window & menu ----

const sendMenu = (cmd) => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('menu', cmd);

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Import Compass export…', accelerator: 'CmdOrCtrl+I', click: () => sendMenu('import') },
        { label: 'Load sample data', click: () => sendMenu('sample') },
        { type: 'separator' },
        { label: 'Back up floor data…', accelerator: 'CmdOrCtrl+B', click: () => sendMenu('backup') },
        { label: 'Restore from backup…', click: () => sendMenu('restore') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Report a bug…', click: () => shell.openExternal(supportMailto('bug')) },
        { label: 'Request a feature…', click: () => shell.openExternal(supportMailto('feature')) },
        { type: 'separator' },
        { label: 'Check for updates…', click: () => checkForUpdatesInteractive() },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#e9e9ec',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  // target="_blank" links (the update chip) go to the system browser,
  // never into a bare Electron child window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  setTimeout(checkForUpdatesQuietly, 2500);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', autoBackup);

app.on('window-all-closed', () => {
  app.quit();
});
