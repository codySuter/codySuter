// Ace Document Studio — Electron main process.
// Documents are plain JSON files in the documents folder (userData by
// default, configurable via File → Choose Documents Folder). PDF/PNG
// export and printing render the document in a hidden window (the
// #/print/<id> and #/compile/<ids> routes) and use Chromium's print
// engine: Letter paper, 0.4in margins, backgrounds on — identical
// geometry to the original policy docs.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = !!DEV_URL;
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;

const VERSION_URL =
  'https://github.com/codysuter/codysuter/releases/download/ace-document-studio-windows/version.txt';
const RELEASE_PAGE = 'https://github.com/codysuter/codysuter/releases/tag/ace-document-studio-windows';
const AUTO_BACKUPS_KEPT = 15;
const HISTORY_KEPT = 40; // snapshots per document
const HISTORY_GAP_MS = 10 * 60 * 1000; // at most one snapshot per stretch
const TRASH_KEPT_MS = 30 * 24 * 60 * 60 * 1000; // deleted docs restorable for 30 days
const PAGE_MARGIN_PX = 38.4; // 0.4in at 96dpi
const PAGE_W_PX = 816; // 8.5in at 96dpi
const PNG_ZOOM = 2; // ~192dpi exports

let mainWindow = null;
const printResolvers = new Map(); // webContents.id -> resolve(info)

// ---- small file helpers ----

// Write via a temp file + rename so a crash mid-write can never corrupt
// a document.
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---- settings (last export folder, custom documents folder) ----

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};

function loadSettings() {
  settings = readJsonSafe(settingsFile()) || {};
  if (typeof settings !== 'object' || settings === null) settings = {};
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Settings are conveniences; never break the app over them.
  }
}

function exportDir() {
  const dir = settings.lastExportDir;
  if (typeof dir === 'string' && fs.existsSync(dir)) return dir;
  return app.getPath('documents');
}

function rememberExportDir(filePath) {
  settings.lastExportDir = path.dirname(filePath);
  saveSettings();
}

// ---- folders ----

function docsDir() {
  let dir = path.join(app.getPath('userData'), 'documents');
  if (typeof settings.documentsDir === 'string' && settings.documentsDir) {
    dir = settings.documentsDir;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    dir = path.join(app.getPath('userData'), 'documents');
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function trashDir() {
  const dir = path.join(app.getPath('userData'), 'trash');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function historyDir(id) {
  const dir = path.join(app.getPath('userData'), 'history', safeId(id));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function templatesDir() {
  const dir = path.join(app.getPath('userData'), 'templates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupsDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
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
    const doc = readJsonSafe(path.join(docsDir(), f));
    if (doc) docs.push(doc);
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

// ---- revision history ----

const lastSnapshotAt = new Map(); // id -> epoch ms of newest snapshot

function newestSnapshot(id) {
  const dir = historyDir(id);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort((a, b) => Number(a.replace('.json', '')) - Number(b.replace('.json', '')));
  return files.length ? files[files.length - 1] : null;
}

// Snapshot the document's current saved file into its history — at most
// once per HISTORY_GAP_MS unless forced (a restore always preserves the
// state it replaces). Skips when nothing changed since the last snapshot.
function maybeSnapshot(id, force = false) {
  try {
    const file = path.join(docsDir(), `${safeId(id)}.json`);
    if (!fs.existsSync(file)) return;
    const dir = historyDir(id);
    let last = lastSnapshotAt.get(id);
    if (last === undefined) {
      const newest = newestSnapshot(id);
      last = newest ? Number(newest.replace('.json', '')) : 0;
      lastSnapshotAt.set(id, last);
    }
    if (!force && Date.now() - last < HISTORY_GAP_MS) return;
    const content = fs.readFileSync(file, 'utf8');
    const newest = newestSnapshot(id);
    if (newest && fs.readFileSync(path.join(dir, newest), 'utf8') === content) return;
    const stamp = Date.now();
    fs.writeFileSync(path.join(dir, `${stamp}.json`), content, 'utf8');
    lastSnapshotAt.set(id, stamp);
    // Cap per-document history.
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .sort((a, b) => Number(a.replace('.json', '')) - Number(b.replace('.json', '')));
    for (const f of files.slice(0, Math.max(0, files.length - HISTORY_KEPT))) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    // History is a safety net; failures must never block saving.
  }
}

ipcMain.handle('history:list', async (_e, id) => {
  try {
    const dir = historyDir(id);
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => ({ file: f, ts: Number(f.replace('.json', '')) }))
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
});

ipcMain.handle('history:read', async (_e, { id, file }) => {
  if (!/^\d+\.json$/.test(String(file))) return null;
  return readJsonSafe(path.join(historyDir(id), String(file)));
});

ipcMain.handle('history:snapshot', async (_e, id) => {
  maybeSnapshot(id, true);
});

// ---- documents ----

ipcMain.handle('docs:list', async () => readAllDocsSync());

ipcMain.handle('docs:save', async (_e, doc) => {
  if (!doc || typeof doc.id !== 'string' || !safeId(doc.id)) {
    throw new Error('Invalid document');
  }
  // The state being replaced becomes a history snapshot (rate-limited),
  // so each editing stretch leaves a restorable trail.
  maybeSnapshot(doc.id);
  await writeJsonAtomic(path.join(docsDir(), `${safeId(doc.id)}.json`), doc);
});

// Soft delete: the file moves to the trash and stays restorable for 30
// days; the renderer offers an immediate Undo.
ipcMain.handle('docs:delete', async (_e, id) => {
  const from = path.join(docsDir(), `${safeId(id)}.json`);
  if (!fs.existsSync(from)) return;
  const to = path.join(trashDir(), `${Date.now()}-${safeId(id)}.json`);
  try {
    await fsp.rename(from, to);
  } catch {
    // Cross-device (custom documents folder on another drive): copy+rm.
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }
});

function pruneTrash() {
  try {
    for (const f of fs.readdirSync(trashDir())) {
      const m = f.match(/^(\d+)-/);
      if (m && Date.now() - Number(m[1]) > TRASH_KEPT_MS) {
        fs.rmSync(path.join(trashDir(), f), { force: true });
      }
    }
  } catch {
    // Trash pruning is housekeeping only.
  }
}

// ---- import / export / backup ----

ipcMain.handle('docs:import', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import documents',
      defaultPath: exportDir(),
      filters: [{ name: 'Documents or backups (JSON)', extensions: ['json'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    const dir = docsDir();
    let added = 0;
    for (const fp of filePaths) {
      const parsed = readJsonSafe(fp);
      if (!parsed) continue;
      for (const doc of docsFromParsed(parsed)) {
        let id = safeId(doc.id);
        // Never overwrite an existing document on import — give the copy a new id.
        if (!id || fs.existsSync(path.join(dir, `${id}.json`))) {
          id = `imp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        }
        doc.id = id;
        doc.updatedAt = Date.now();
        await writeJsonAtomic(path.join(dir, `${id}.json`), doc);
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
      defaultPath: path.join(exportDir(), `${safeName(doc.title)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await writeJsonAtomic(filePath, doc);
    rememberExportDir(filePath);
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
      defaultPath: path.join(exportDir(), `AceDocumentStudio-backup-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await writeJsonAtomic(filePath, backupBundle(docs));
    rememberExportDir(filePath);
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
    const dir = backupsDir();
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

ipcMain.handle('backups:list', async () => {
  try {
    return fs
      .readdirSync(backupsDir())
      .filter((f) => f.startsWith('auto-') && f.endsWith('.json'))
      .map((f) => {
        const parsed = readJsonSafe(path.join(backupsDir(), f));
        const st = fs.statSync(path.join(backupsDir(), f));
        return {
          file: f,
          ts: st.mtimeMs,
          count: parsed && Array.isArray(parsed.documents) ? parsed.documents.length : 0,
        };
      })
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
});

// Replace the library with a backup's contents. The current library is
// auto-backed-up first, and its files move to the trash (not deleted).
ipcMain.handle('backups:restore', async (_e, file) => {
  try {
    const name = path.basename(String(file));
    const parsed = readJsonSafe(path.join(backupsDir(), name));
    const docs = docsFromParsed(parsed);
    if (docs.length === 0) return { ok: false, error: 'That backup file has no documents in it.' };
    autoBackup();
    const dir = docsDir();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const to = path.join(trashDir(), `${Date.now()}-${f}`);
      try {
        fs.renameSync(path.join(dir, f), to);
      } catch {
        fs.copyFileSync(path.join(dir, f), to);
        fs.rmSync(path.join(dir, f), { force: true });
      }
    }
    let count = 0;
    for (const doc of docs) {
      const id = safeId(doc.id) || `res-${Date.now().toString(36)}-${count}`;
      doc.id = id;
      await writeJsonAtomic(path.join(dir, `${id}.json`), doc);
      count++;
    }
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---- templates ----

ipcMain.handle('templates:list', async () => {
  try {
    return fs
      .readdirSync(templatesDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJsonSafe(path.join(templatesDir(), f)))
      .filter((t) => t && typeof t.id === 'string' && t.doc)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch {
    return [];
  }
});

ipcMain.handle('templates:save', async (_e, { name, doc }) => {
  try {
    if (!doc || !Array.isArray(doc.blocks)) throw new Error('Invalid document');
    const id = `tpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    await writeJsonAtomic(path.join(templatesDir(), `${id}.json`), {
      id,
      name: String(name || 'My template').slice(0, 80),
      savedAt: Date.now(),
      doc,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('templates:delete', async (_e, id) => {
  await fsp.rm(path.join(templatesDir(), `${safeId(id)}.json`), { force: true });
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

// The installed (NSIS) build updates itself through electron-updater;
// the portable exe keeps the manual download flow.
let updater = null;

function initUpdater() {
  if (isDev || isPortable || !app.isPackaged) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    updater = null;
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-downloaded', (info) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    void dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update ready',
        message: `Version ${info.version} has been downloaded.`,
        detail: 'Restart to finish updating. Your documents are untouched.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) updater.quitAndInstall();
      });
  });
  updater.on('error', () => {
    // Quiet: the interactive check surfaces problems when asked.
  });
  updater.checkForUpdates().catch(() => {});
}

async function checkForUpdatesQuietly() {
  if (updater) return; // electron-updater already checked on launch
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
    if (updater) {
      const r = await updater.checkForUpdates();
      const remote = r && r.updateInfo ? r.updateInfo.version : null;
      if (remote && newerVersion(remote, app.getVersion())) {
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update available',
          message: `Version ${remote} is downloading in the background.`,
          detail: "You'll be asked to restart when it's ready.",
        });
      } else {
        await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Up to date',
          message: `You're on the latest version (${app.getVersion()}).`,
        });
      }
      return;
    }
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

// ---- print / PDF / PNG ----

ipcMain.on('print:ready', (e, info) => {
  const resolve = printResolvers.get(e.sender.id);
  if (resolve) {
    printResolvers.delete(e.sender.id);
    resolve(info || {});
  }
});

async function openRenderWindow(hash) {
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
  if (isDev) await win.loadURL(`${DEV_URL}#${hash}`);
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
  const info = await ready;
  return { win, info };
}

const openPrintWindow = (id) => openRenderWindow(`/print/${encodeURIComponent(id)}`);

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
      defaultPath: path.join(exportDir(), `${safeName(title)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, pdf);
    rememberExportDir(filePath);
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});

// One PNG per printed page (manual page breaks split pages), captured at
// 2× for crisp postings, with the letter margins baked in so each file
// looks like the printed sheet.
ipcMain.handle('doc:export-png', async (_e, { id, title }) => {
  let win = null;
  try {
    const opened = await openPrintWindow(id);
    win = opened.win;
    const wc = win.webContents;
    await wc.insertCSS(`body { padding: ${PAGE_MARGIN_PX}px; background: #fff; }`);
    const layout = await wc.executeJavaScript(`(() => {
      const doc = document.querySelector('[data-testid="page-print"]');
      if (!doc) return null;
      const r = doc.getBoundingClientRect();
      const breaks = [...document.querySelectorAll('[data-pagebreak]')]
        .map((b) => b.getBoundingClientRect().top - r.top)
        .filter((y) => y > 1 && y < r.height - 1);
      return { height: r.height, breaks };
    })()`);
    if (!layout) throw new Error('The document did not render.');
    const cuts = [0, ...layout.breaks, layout.height];
    const z = PNG_ZOOM;
    wc.setZoomFactor(z);
    win.setContentSize(
      Math.ceil(PAGE_W_PX * z),
      Math.ceil((layout.height + 2 * PAGE_MARGIN_PX) * z),
    );
    await new Promise((r) => setTimeout(r, 400));

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export PNG',
      defaultPath: path.join(exportDir(), `${safeName(title)}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const paths = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const top = cuts[i];
      const height = cuts[i + 1] - top + 2 * PAGE_MARGIN_PX;
      const image = await wc.capturePage({
        x: 0,
        y: Math.round(top * z),
        width: Math.round(PAGE_W_PX * z),
        height: Math.round(height * z),
      });
      const out =
        i === 0
          ? filePath
          : filePath.replace(/\.png$/i, '') + `-${i + 1}.png`;
      await fsp.writeFile(out, image.toPNG());
      paths.push(out);
    }
    rememberExportDir(filePath);
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath, paths };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});

// Several documents → one PDF: cover page, optional table of contents,
// each document on a fresh page, continuous page footers throughout.
ipcMain.handle('compile:export-pdf', async (_e, { ids, title, toc }) => {
  let win = null;
  try {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('No documents selected');
    const hash = `/compile/${ids.map((i) => encodeURIComponent(safeId(i))).join(',')}?title=${encodeURIComponent(String(title))}&toc=${toc ? 1 : 0}`;
    const opened = await openRenderWindow(hash);
    win = opened.win;
    const pdf = await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: PAGE_FOOTER_TEMPLATE,
    });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export compiled PDF',
      defaultPath: path.join(exportDir(), `${safeName(title)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, pdf);
    rememberExportDir(filePath);
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

// ---- documents folder ----

async function chooseDocumentsFolder() {
  const current = docsDir();
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the documents folder',
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || filePaths.length === 0) return;
  const target = filePaths[0];
  if (path.resolve(target) === path.resolve(current)) return;
  const existing = fs.readdirSync(current).filter((f) => f.endsWith('.json'));
  if (existing.length > 0) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Copy documents?',
      message: `Copy your ${existing.length} document${existing.length === 1 ? '' : 's'} to the new folder?`,
      detail:
        'Copying keeps a duplicate in the old folder as a fallback. A shared or synced folder lets every machine in the store use the same library.',
      buttons: ['Copy them', 'Start with what’s there', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return;
    if (response === 0) {
      for (const f of existing) {
        const to = path.join(target, f);
        if (!fs.existsSync(to)) fs.copyFileSync(path.join(current, f), to);
      }
    }
  }
  settings.documentsDir = target;
  saveSettings();
  sendMenu('refresh-library');
}

function useDefaultDocumentsFolder() {
  if (!settings.documentsDir) return;
  delete settings.documentsDir;
  saveSettings();
  sendMenu('refresh-library');
}

// ---- spellcheck context menu ----

// Right-click suggestions for the red-squiggled word, plus the standard
// clipboard actions in text fields.
function attachContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const items = [];
    for (const s of (params.dictionarySuggestions || []).slice(0, 6)) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    }
    if (params.misspelledWord) {
      if (items.length === 0) items.push({ label: 'No suggestions', enabled: false });
      items.push(
        { type: 'separator' },
        {
          label: `Add “${params.misspelledWord}” to dictionary`,
          click: () =>
            win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
      );
    }
    if (params.isEditable) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    } else if (params.selectionText && params.selectionText.trim()) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push({ role: 'copy' });
    }
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

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
      { label: 'New Document…', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-doc') },
      { label: 'Back to Library', accelerator: 'CmdOrCtrl+L', click: () => sendMenu('library') },
      { type: 'separator' },
      { label: 'Export PDF…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export-pdf') },
      { label: 'Export PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenu('export-png') },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendMenu('print') },
      { type: 'separator' },
      { label: 'Save as Template…', click: () => sendMenu('save-template') },
      { label: 'Version History…', click: () => sendMenu('history') },
      { type: 'separator' },
      { label: 'Import Documents…', click: () => sendMenu('import') },
      { label: 'Back Up Library…', click: () => sendMenu('backup') },
      { label: 'Restore from Backup…', click: () => sendMenu('restore-backup') },
      { type: 'separator' },
      { label: 'Choose Documents Folder…', click: () => void chooseDocumentsFolder() },
      { label: 'Use Default Documents Folder', click: () => useDefaultDocumentsFolder() },
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
      { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => sendMenu('shortcuts') },
      { type: 'separator' },
      {
        label: 'About Ace Document Studio',
        click: () =>
          dialog.showMessageBox(mainWindow, {
            title: 'Ace Document Studio',
            message: `Ace Document Studio ${app.getVersion()}`,
            detail:
              "Design Snyder's Ace Hardware store documents — policies, procedures, postings, agreements — with drag-and-drop sections, brand fonts, and print-ready PDF export.",
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
  attachContextMenu(mainWindow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (isDev) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  loadSettings();
  migrateLegacyDocs();
  pruneTrash();
  try {
    session.defaultSession.setSpellCheckerLanguages(['en-US']);
  } catch {
    // The OS spellchecker (Windows) picks its own languages.
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createMainWindow();
  initUpdater();
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
