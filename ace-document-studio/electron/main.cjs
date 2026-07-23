// Ace Document Studio — Electron main process.
// Documents are plain JSON files in userData/documents. PDF export and
// printing render the document in a hidden window (the #/print/<id>
// route) and use Chromium's print engine: Letter paper, 0.4in margins,
// backgrounds on — identical geometry to the original policy docs.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = !!DEV_URL;

let mainWindow = null;
const printResolvers = new Map(); // webContents.id -> resolve()

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
  (String(name).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Document').slice(0, 120);

ipcMain.handle('docs:list', async () => {
  const dir = docsDir();
  const files = await fsp.readdir(dir);
  const docs = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      docs.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')));
    } catch {
      // Skip an unreadable file rather than break the library.
    }
  }
  docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return docs;
});

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

ipcMain.on('print:ready', (e) => {
  const resolve = printResolvers.get(e.sender.id);
  if (resolve) {
    printResolvers.delete(e.sender.id);
    resolve();
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
  await ready;
  return win;
}

ipcMain.handle('doc:export-pdf', async (_e, { id, title }) => {
  let win = null;
  try {
    win = await openPrintWindow(id);
    const pdf = await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
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
    win = await openPrintWindow(id);
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
