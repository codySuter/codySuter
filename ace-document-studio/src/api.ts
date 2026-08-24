import type { StudioDoc, UserTemplate } from './model/types';

export type FileResult = { ok: boolean; path?: string; canceled?: boolean; error?: string };

export interface HistoryEntry {
  /** Opaque handle for readHistory (a filename in Electron). */
  file: string;
  ts: number;
}

export interface BackupEntry {
  file: string;
  ts: number;
  count: number;
}

export interface StudioApi {
  isElectron: boolean;
  listDocs(): Promise<StudioDoc[]>;
  saveDoc(doc: StudioDoc): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  exportPdf(id: string, title: string): Promise<FileResult>;
  exportPng(id: string, title: string): Promise<FileResult & { paths?: string[] }>;
  compilePdf(ids: string[], title: string, toc: boolean): Promise<FileResult>;
  printDoc(id: string): Promise<{ ok: boolean; error?: string }>;
  printReady(info: { multiPage: boolean }): void;
  onMenu(handler: (cmd: string) => void): () => void;
  onUpdate(handler: (version: string) => void): () => void;
  importDocs(): Promise<{ ok: boolean; added?: number; canceled?: boolean; error?: string }>;
  exportDocJson(doc: StudioDoc): Promise<FileResult>;
  backupLibrary(): Promise<FileResult & { count?: number }>;
  // Saved templates (user's own starting points).
  listTemplates(): Promise<UserTemplate[]>;
  saveTemplate(name: string, doc: StudioDoc): Promise<{ ok: boolean; error?: string }>;
  deleteTemplate(id: string): Promise<void>;
  // Revision history: snapshots of saved states, at most one per editing
  // stretch, restorable from the editor's History panel.
  listHistory(docId: string): Promise<HistoryEntry[]>;
  readHistory(docId: string, file: string): Promise<StudioDoc | null>;
  /** Force-snapshot the doc's current saved state (called before a restore). */
  snapshotHistory(docId: string): Promise<void>;
  // Automatic whole-library backups (rotating, written on quit).
  listBackups(): Promise<BackupEntry[]>;
  restoreBackup(file: string): Promise<{ ok: boolean; count?: number; error?: string }>;
  // OS clipboard (block copy/paste works across documents and windows).
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
}

declare global {
  interface Window {
    aps?: StudioApi; // "aps" predates the Ace Document Studio rename
  }
}

// Browser fallback (dev server / tests): documents live in localStorage,
// print/PDF go through the browser's own print dialog, and file tools
// use downloads / a file picker.
const LS_KEY = 'aps.docs.v1';
const LS_TPL_KEY = 'aps.tpl.v1';
const LS_HIST_PREFIX = 'aps.hist.';
const HIST_KEEP = 15;
const HIST_MIN_GAP_MS = 10 * 60 * 1000;

function readAll(): Record<string, StudioDoc> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, StudioDoc>): void {
  localStorage.setItem(LS_KEY, JSON.stringify(map));
}

function readHist(id: string): { ts: number; doc: StudioDoc }[] {
  try {
    return JSON.parse(localStorage.getItem(LS_HIST_PREFIX + id) ?? '[]');
  } catch {
    return [];
  }
}

function writeHist(id: string, entries: { ts: number; doc: StudioDoc }[]): void {
  localStorage.setItem(LS_HIST_PREFIX + id, JSON.stringify(entries.slice(-HIST_KEEP)));
}

function snapshotBrowser(id: string, force: boolean): void {
  const existing = readAll()[id];
  if (!existing) return;
  const hist = readHist(id);
  const last = hist[hist.length - 1];
  if (!force && last && Date.now() - last.ts < HIST_MIN_GAP_MS) return;
  if (last && JSON.stringify(last.doc) === JSON.stringify(existing)) return;
  hist.push({ ts: Date.now(), doc: existing });
  writeHist(id, hist);
}

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickJsonFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// A file is either one document or a backup bundle { documents: [...] }.
export function docsFromParsedJson(parsed: unknown): StudioDoc[] {
  const looksLikeDoc = (d: unknown): d is StudioDoc =>
    !!d &&
    typeof d === 'object' &&
    typeof (d as StudioDoc).id === 'string' &&
    Array.isArray((d as StudioDoc).blocks);
  if (looksLikeDoc(parsed)) return [parsed];
  const bundle = parsed as { documents?: unknown[] } | null;
  if (bundle && Array.isArray(bundle.documents)) return bundle.documents.filter(looksLikeDoc);
  return [];
}

const browserApi: StudioApi = {
  isElectron: false,
  async listDocs() {
    return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async saveDoc(doc) {
    snapshotBrowser(doc.id, false);
    const map = readAll();
    map[doc.id] = doc;
    writeAll(map);
  },
  async deleteDoc(id) {
    const map = readAll();
    delete map[id];
    writeAll(map);
  },
  async exportPdf(id) {
    window.location.hash = `#/print/${id}`;
    return { ok: true };
  },
  async exportPng() {
    return { ok: false, error: 'PNG export is available in the desktop app.' };
  },
  async compilePdf(ids, title, toc) {
    window.location.hash = `#/compile/${ids.join(',')}?title=${encodeURIComponent(title)}&toc=${toc ? 1 : 0}`;
    return { ok: true };
  },
  async printDoc(id) {
    window.location.hash = `#/print/${id}`;
    return { ok: true };
  },
  printReady() {
    // In-browser the print view triggers window.print() itself.
  },
  onMenu() {
    return () => {};
  },
  onUpdate() {
    return () => {};
  },
  async importDocs() {
    const files = await pickJsonFiles();
    if (files.length === 0) return { ok: false, canceled: true };
    const map = readAll();
    let added = 0;
    for (const f of files) {
      try {
        for (const doc of docsFromParsedJson(JSON.parse(await f.text()))) {
          if (map[doc.id]) doc.id = `imp-${Date.now().toString(36)}-${added}`;
          doc.updatedAt = Date.now();
          map[doc.id] = doc;
          added++;
        }
      } catch {
        // Skip an unreadable file; report what did import.
      }
    }
    writeAll(map);
    return { ok: true, added };
  },
  async exportDocJson(doc) {
    downloadJson(`${doc.id}.json`, doc);
    return { ok: true };
  },
  async backupLibrary() {
    const docs = Object.values(readAll());
    downloadJson('AceDocumentStudio-backup.json', {
      app: 'ace-document-studio',
      exportedAt: new Date().toISOString(),
      documents: docs,
    });
    return { ok: true, count: docs.length };
  },
  async listTemplates() {
    try {
      const map: Record<string, UserTemplate> = JSON.parse(
        localStorage.getItem(LS_TPL_KEY) ?? '{}',
      );
      return Object.values(map).sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  },
  async saveTemplate(name, doc) {
    const map: Record<string, UserTemplate> = JSON.parse(localStorage.getItem(LS_TPL_KEY) ?? '{}');
    const id = `tpl-${Date.now().toString(36)}`;
    map[id] = { id, name, savedAt: Date.now(), doc };
    localStorage.setItem(LS_TPL_KEY, JSON.stringify(map));
    return { ok: true };
  },
  async deleteTemplate(id) {
    const map: Record<string, UserTemplate> = JSON.parse(localStorage.getItem(LS_TPL_KEY) ?? '{}');
    delete map[id];
    localStorage.setItem(LS_TPL_KEY, JSON.stringify(map));
  },
  async listHistory(docId) {
    return readHist(docId)
      .map((h) => ({ file: String(h.ts), ts: h.ts }))
      .reverse();
  },
  async readHistory(docId, file) {
    return readHist(docId).find((h) => String(h.ts) === file)?.doc ?? null;
  },
  async snapshotHistory(docId) {
    snapshotBrowser(docId, true);
  },
  async listBackups() {
    return [];
  },
  async restoreBackup() {
    return { ok: false, error: 'Automatic backups live in the desktop app.' };
  },
  async readClipboardText() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },
  async writeClipboardText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable (permissions) — copy silently fails.
    }
  },
};

export const api: StudioApi = window.aps ?? browserApi;
