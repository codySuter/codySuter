// Ace Document Studio — Electron main process.
// Documents are plain JSON files in userData/documents. PDF export and
// printing render the document in a hidden window (the #/print/<id>
// route) and use Chromium's print engine: Letter paper, 0.4in margins,
// backgrounds on — identical geometry to the original policy docs.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = !!DEV_URL;

const SUPPORT_EMAIL = 'csuter@snydersace.net';
const VERSION_URL =
  'https://github.com/codysuter/codysuter/releases/download/ace-document-studio-windows/version.txt';
const RELEASE_PAGE = 'https://github.com/codysuter/codysuter/releases/tag/ace-document-studio-windows';
const AUTO_BACKUPS_KEPT = 15;

let mainWindow = null;
const printResolvers = new Map(); // webContents.id -> resolve(info)

function docsDir() {
  const dir = path.join(app.getPath('userData'), 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// One-time migration: the app used to be "Ace Policy Studio", and
// userData follows productName — copy documents from the old folder so
// the rename doesn't empty anyone's library. Never blocks launch.
function migrateLegacyDocs() {
  try {
    const dir = docsDir();
    if (fs.readdirSync(dir).some((f) => f.endsWith('.json'))) return;
    const legacy = path.join(app.getPath('appData'), 'Ace Policy Studio', 'documents');
    if (!fs.existsSync(legacy)) return;
    for (const f of fs.readdirSync(legacy)) {
      if (f.endsWith('.json')) fs.copyFileSync(path.join(legacy, f), path.join(dir, f));
    }
  } catch {
    // A failed migration just means the library starts empty.
  }
}

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9-_]/g, '');
const safeName = (name) =>
  (String(name).replace(/<[^>]*>/g, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Document').slice(0, 120);

function readAllDocsSync() {
  const docs = [];
  for (const f of fs.readdirSync(docsDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      docs.push(JSON.parse(fs.readFileSync(path.join(docsDir(), f), 'utf8')));
    } catch {
      // Skip an unreadable file rather than break the library.
    }
  }
  docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return docs;
}

const backupBundle = (docs) => ({
  app: 'ace-document-studio',
  version: app.getVersion(),
  exportedAt: new Date().toISOString(),
  documents: docs,
});

// A JSON file is either one document or a backup bundle { documents: [...] }.
function docsFromParsed(parsed) {
  const looksLikeDoc = (d) =>
    !!d && typeof d === 'object' && typeof d.id === 'string' && Array.isArray(d.blocks);
  if (looksLikeDoc(parsed)) return [parsed];
  if (parsed && Array.isArray(parsed.documents)) return parsed.documents.filter(looksLikeDoc);
  return [];
}

ipcMain.handle('docs:list', async () => readAllDocsSync());

ipcMain.handle('docs:save', async (_e, doc) => {
  if (!doc || typeof doc.id !== 'string' || !safeId(doc.id)) {
    throw new Error('Invalid document');
  }
  const file = path.join(docsDir(), `${safeId(doc.id)}.json`);
  await fsp.writeFile(file, JSON.stringify(doc, null, 2), 'utf8');
});

ipcMain.handle('docs:delete', async (_e, id) => {
  await fsp.rm(path.join(docsDir(), `${safeId(id)}.json`), { force: true });
});

// ---- import / export / backup ----

ipcMain.handle('docs:import', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import documents',
      filters: [{ name: 'Documents or backups (JSON)', extensions: ['json'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    const dir = docsDir();
    let added = 0;
    for (const fp of filePaths) {
      let parsed;
      try {
        parsed = JSON.parse(await fsp.readFile(fp, 'utf8'));
      } catch {
        continue;
      }
      for (const doc of docsFromParsed(parsed)) {
        let id = safeId(doc.id);
        // Never overwrite an existing document on import — give the copy a new id.
        if (!id || fs.existsSync(path.join(dir, `${id}.json`))) {
          id = `imp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        }
        doc.id = id;
        doc.updatedAt = Date.now();
        await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(doc, null, 2), 'utf8');
        added++;
      }
    }
    return { ok: true, added };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('doc:export-json', async (_e, doc) => {
  try {
    if (!doc || typeof doc.id !== 'string') throw new Error('Invalid document');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export document as JSON',
      defaultPath: path.join(app.getPath('documents'), `${safeName(doc.title)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, JSON.stringify(doc, null, 2), 'utf8');
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('library:backup', async () => {
  try {
    const docs = readAllDocsSync();
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Back up library',
      defaultPath: path.join(app.getPath('documents'), `AceDocumentStudio-backup-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, JSON.stringify(backupBundle(docs), null, 2), 'utf8');
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath, count: docs.length };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Safety net: a rotating automatic backup of the whole library on every
// quit, in userData/backups. Keeps the newest AUTO_BACKUPS_KEPT files.
function autoBackup() {
  try {
    const docs = readAllDocsSync();
    if (docs.length === 0) return;
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(
      path.join(dir, `auto-${stamp}.json`),
      JSON.stringify(backupBundle(docs), null, 2),
      'utf8',
    );
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
  const subject = `Ace Document Studio ${app.getVersion()} — ${label}`;
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
        detail:
          'The download replaces AceDocumentStudio.exe. Your documents live in their own folder and are untouched.',
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

// ---- print / PDF ----

ipcMain.on('print:ready', (e, info) => {
  const resolve = printResolvers.get(e.sender.id);
  if (resolve) {
    printResolvers.delete(e.sender.id);
    resolve(info || {});
  }
});

async function openPrintWindow(id) {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1100,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  const ready = new Promise((resolve, reject) => {
    printResolvers.set(win.webContents.id, resolve);
    setTimeout(() => {
      if (printResolvers.delete(win.webContents.id)) {
        reject(new Error('The document took too long to lay out.'));
      }
    }, 20000);
  });
  const hash = `/print/${encodeURIComponent(id)}`;
  if (isDev) await win.loadURL(`${DEV_URL}#${hash}`);
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
  const info = await ready;
  return { win, info };
}

// Small centered "PAGE x OF y" line inside the bottom margin; only added
// when the document actually spans multiple pages.
const PAGE_FOOTER_TEMPLATE =
  '<div style="width:100%;text-align:center;font-family:Arial,sans-serif;' +
  'font-size:7.5px;letter-spacing:2px;color:#8a9099;">' +
  'PAGE <span class="pageNumber"></span> OF <span class="totalPages"></span></div>';

ipcMain.handle('doc:export-pdf', async (_e, { id, title }) => {
  let win = null;
  try {
    const opened = await openPrintWindow(id);
    win = opened.win;
    const multiPage = !!(opened.info && opened.info.multiPage);
    const pdf = await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      ...(multiPage
        ? {
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: PAGE_FOOTER_TEMPLATE,
          }
        : {}),
    });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export PDF',
      defaultPath: path.join(app.getPath('documents'), `${safeName(title)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, pdf);
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});

ipcMain.handle('doc:print', async (_e, { id }) => {
  let win = null;
  try {
    ({ win } = await openPrintWindow(id));
    const result = await new Promise((resolve) => {
      win.webContents.print({ printBackground: true }, (success, failureReason) =>
        resolve({ success, failureReason }),
      );
    });
    if (!result.success && !/cancel/i.test(result.failureReason || '')) {
      return { ok: false, error: result.failureReason || 'Print failed' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});

// ---- menu / windows ----

function sendMenu(cmd) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu', cmd);
  }
}

const menuTemplate = [
  {
    label: 'File',
    submenu: [
      { label: 'New Document', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-doc') },
      { label: 'Back to Library', accelerator: 'CmdOrCtrl+L', click: () => sendMenu('library') },
      { type: 'separator' },
      { label: 'Export PDF…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export-pdf') },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendMenu('print') },
      { type: 'separator' },
      { label: 'Import Documents…', click: () => sendMenu('import') },
      { label: 'Back Up Library…', click: () => sendMenu('backup') },
      { label: 'Reveal Documents Folder', click: () => void shell.openPath(docsDir()) },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      // Custom undo/redo so document history (not just text) rewinds.
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenu('redo') },
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
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  {
    label: 'Help',
    submenu: [
      { label: 'Check for Updates…', click: () => void checkForUpdatesInteractive() },
      { type: 'separator' },
      { label: 'Report a Bug…', click: () => void shell.openExternal(supportMailto('bug')) },
      {
        label: 'Request a Feature…',
        click: () => void shell.openExternal(supportMailto('feature')),
      },
      { type: 'separator' },
      {
        label: 'About Ace Document Studio',
        click: () =>
          dialog.showMessageBox(mainWindow, {
            title: 'Ace Document Studio',
            message: `Ace Document Studio ${app.getVersion()}`,
            detail:
              "Design Snyder's Ace Hardware policy, procedure & store documents — drag-and-drop sections, brand fonts, one-page fit meter, print-ready PDF export.",
          }),
      },
    ],
  },
];

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 660,
    backgroundColor: '#E9E9EC',
    title: 'Ace Document Studio',
    icon:
      process.platform === 'linux'
        ? path.join(__dirname, '..', 'build', 'icon.png')
        : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  // Any link the page opens (mailto, release page) goes to the OS, never
  // to a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (isDev) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  migrateLegacyDocs();
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createMainWindow();
  if (!isDev) setTimeout(() => void checkForUpdatesQuietly(), 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Runs after every window (and its final flush-save) has closed.
app.on('will-quit', autoBackup);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
