// Ace Policy Studio — Electron main process.
// Documents are plain JSON files in userData/documents. PDF export and
// printing render the document in a hidden window (the #/print/<id>
// route) and use Chromium's print engine: Letter paper, 0.4in margins,
// backgrounds on — identical geometry to the original policy docs.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { initLog, log, tail, getLogPath } = require('./log.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = !!DEV_URL;

let mainWindow = null;
const printResolvers = new Map(); // webContents.id -> resolve()

function docsDir() {
  const dir = path.join(app.getPath('userData'), 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9-_]/g, '');
const safeName = (name) =>
  (String(name).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Policy document').slice(0, 120);

async function readAllDocs() {
  const dir = docsDir();
  const files = await fsp.readdir(dir);
  const docs = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      docs.push(JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')));
    } catch (err) {
      // Skip an unreadable file rather than break the library.
      log('[docs] unreadable file skipped', f, String((err && err.message) || err));
    }
  }
  docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return docs;
}

ipcMain.handle('docs:list', () => readAllDocs());

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
    log('[export] PDF saved', filePath, `${pdf.length} bytes`);
    return { ok: true, path: filePath };
  } catch (err) {
    log('[export] FAILED', String((err && err.message) || err));
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
      log('[print] FAILED', result.failureReason || 'unknown');
      return { ok: false, error: result.failureReason || 'Print failed' };
    }
    log('[print]', result.success ? 'sent to printer' : 'canceled by user');
    return { ok: true };
  } catch (err) {
    log('[print] FAILED', String((err && err.message) || err));
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

// ---- support tickets -----------------------------------------------------
// The app has no mail server, so a ticket = a full diagnostics report
// written to the Desktop + copied to the clipboard, and a pre-addressed
// email draft opened in the machine's mail app.
const SUPPORT_EMAIL = 'csuter@snydersace.net';
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();

ipcMain.on('log:renderer', (_e, text) => {
  log('[renderer]', String(text).slice(0, 2000));
});

ipcMain.handle('support:ticket', async (_e, t) => {
  try {
    const category = ['Bug', 'Issue', 'Feature idea'].includes(t && t.category)
      ? t.category
      : 'Issue';
    const message = String((t && t.message) || '').slice(0, 4000);
    const expected = String((t && t.expected) || '').slice(0, 2000);
    const reporter = String((t && t.reporter) || '').slice(0, 120);

    let docLines = [];
    try {
      const docs = await readAllDocs();
      docLines = docs.map(
        (d) =>
          `  - ${stripTags(d.title) || 'Untitled'} (${(d.blocks || []).length} blocks, updated ${new Date(d.updatedAt || 0).toISOString()})`,
      );
    } catch (err) {
      docLines = [`  (could not list documents: ${String((err && err.message) || err)})`];
    }

    const now = new Date();
    const diagnostics = [
      '=== ACE POLICY STUDIO SUPPORT TICKET ===',
      `Category:      ${category}`,
      `Reported by:   ${reporter || '(not given)'}`,
      `Date:          ${now.toString()}`,
      '',
      '--- What happened ---',
      message || '(no description)',
      ...(expected ? ['', '--- What was expected ---', expected] : []),
      '',
      '--- App & system ---',
      `App version:   ${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`,
      `Electron:      ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
      `OS:            ${os.type()} ${os.release()} (${os.arch()})`,
      `Machine:       ${os.hostname()}`,
      `Locale:        ${app.getLocale()}`,
      `Data folder:   ${app.getPath('userData')}`,
      `Log file:      ${getLogPath() || '(none)'}`,
      '',
      `--- Documents in library (${docLines.length}) ---`,
      ...docLines,
      '',
      '--- Recent app log ---',
      tail(200),
      '',
      '=== END OF TICKET ===',
    ].join('\n');

    // Full report → Desktop (fall back to the data folder), + clipboard.
    const stamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const fileName = `AcePolicyStudio-Support-${stamp}.txt`;
    let reportPath = path.join(app.getPath('desktop'), fileName);
    try {
      await fsp.writeFile(reportPath, diagnostics, 'utf8');
    } catch {
      reportPath = path.join(app.getPath('userData'), fileName);
      await fsp.writeFile(reportPath, diagnostics, 'utf8');
    }
    try {
      clipboard.writeText(diagnostics);
    } catch {
      // Clipboard is a convenience, not a requirement.
    }

    // Email body must stay well under Windows' mailto length limit, so it
    // carries the message + a compact summary and points at the report file.
    const shortLog = tail(12);
    const body = [
      `Category: ${category}`,
      reporter ? `Reported by: ${reporter}` : null,
      '',
      'What happened:',
      message.slice(0, 900),
      ...(expected ? ['', 'What was expected:', expected.slice(0, 300)] : []),
      '',
      '--- Quick diagnostics ---',
      `App v${app.getVersion()} · ${os.type()} ${os.release()} · ${os.hostname()}`,
      `Documents: ${docLines.length} · Data: ${app.getPath('userData')}`,
      '',
      `FULL REPORT: "${fileName}" was saved to the Desktop — please attach it to this email.`,
      '(It was also copied to the clipboard.)',
      '',
      'Recent log:',
      shortLog.slice(-500),
    ]
      .filter((l) => l !== null)
      .join('\n');
    const subject = `[Ace Policy Studio ${app.getVersion()}] ${category}: ${stripTags(message).slice(0, 60) || 'support ticket'}`;
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    let opened = true;
    try {
      await shell.openExternal(mailto);
    } catch {
      opened = false;
    }
    log('[support] ticket created', category, opened ? 'mailto opened' : 'mailto FAILED', reportPath);
    return { ok: true, opened, reportPath, email: SUPPORT_EMAIL };
  } catch (err) {
    log('[support] FAILED', String((err && err.message) || err));
    return { ok: false, error: String((err && err.message) || err), email: SUPPORT_EMAIL };
  }
});

// ---- auto-update (GitHub Releases + electron-updater) -------------------
// On launch (packaged builds only): check GitHub, download in the
// background, then offer "Restart & Update" — or install on quit.
let updater = null;
let manualCheck = false;

function sendUpdateStatus(text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', text);
  }
}

function ensureUpdater() {
  if (updater || !app.isPackaged) return updater;
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = {
    info: (m) => log('[updater]', String(m)),
    warn: (m) => log('[updater] WARN', String(m)),
    error: (m) => log('[updater] ERROR', String(m)),
    debug: () => {},
  };

  updater.on('update-available', (info) => {
    sendUpdateStatus(`Update v${info.version} found — downloading in the background…`);
  });
  updater.on('update-not-available', () => {
    if (manualCheck) {
      dialog.showMessageBox(mainWindow, {
        title: 'Up to date',
        message: `You're on the latest version (v${app.getVersion()}).`,
      });
    }
    manualCheck = false;
  });
  updater.on('error', (err) => {
    if (manualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update check failed',
        message: 'Couldn’t check for updates.',
        detail: String((err && err.message) || err),
      });
    }
    manualCheck = false;
  });
  updater.on('update-downloaded', async (info) => {
    sendUpdateStatus(`Update v${info.version} is ready.`);
    manualCheck = false;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart & Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Ace Policy Studio v${info.version} is ready to install.`,
      detail:
        'Restart now to update — or keep working, and it installs itself when you close the app. Your documents are not affected.',
    });
    if (response === 0) {
      setImmediate(() => updater.quitAndInstall(true, true));
    }
  });
  return updater;
}

function checkForUpdates(fromMenu) {
  if (!app.isPackaged) {
    if (fromMenu) {
      dialog.showMessageBox(mainWindow, {
        title: 'Development build',
        message: 'Update checks only run in the packaged app.',
      });
    }
    return;
  }
  manualCheck = !!fromMenu;
  ensureUpdater()
    .checkForUpdates()
    .catch(() => {
      // Offline or GitHub unreachable — silent unless manually invoked
      // (the 'error' handler above covers the manual case).
    });
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
        label: 'Report a Problem…',
        accelerator: 'CmdOrCtrl+Shift+H',
        click: () => sendMenu('support'),
      },
      {
        label: 'Check for Updates…',
        click: () => checkForUpdates(true),
      },
      { type: 'separator' },
      {
        label: 'About Ace Policy Studio',
        click: () =>
          dialog.showMessageBox(mainWindow, {
            title: 'Ace Policy Studio',
            message: `Ace Policy Studio ${app.getVersion()}`,
            detail:
              "Design Snyder's Ace Hardware policy & procedure documents — drag-and-drop sections, brand fonts, one-page fit meter, print-ready PDF export.",
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
    title: 'Ace Policy Studio',
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

process.on('uncaughtException', (err) => {
  log('[crash] uncaughtException', String((err && err.stack) || err));
});
process.on('unhandledRejection', (reason) => {
  log('[crash] unhandledRejection', String(reason));
});

app.whenReady().then(() => {
  initLog(app);
  log(
    '[app] start',
    `v${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`,
    `${os.type()} ${os.release()} ${os.arch()}`,
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createMainWindow();
  // Give the window a moment to paint before hitting the network.
  setTimeout(() => checkForUpdates(false), 2500);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
