import type { StudioDoc } from './model/types';

export type FileResult = { ok: boolean; path?: string; canceled?: boolean; error?: string };

export interface StudioApi {
  isElectron: boolean;
  listDocs(): Promise<StudioDoc[]>;
  saveDoc(doc: StudioDoc): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  exportPdf(id: string, title: string): Promise<FileResult>;
  printDoc(id: string): Promise<{ ok: boolean; error?: string }>;
  printReady(info: { multiPage: boolean }): void;
  onMenu(handler: (cmd: string) => void): () => void;
  onUpdate(handler: (version: string) => void): () => void;
  openSupport(kind: 'bug' | 'feature'): void;
  importDocs(): Promise<{ ok: boolean; added?: number; canceled?: boolean; error?: string }>;
  exportDocJson(doc: StudioDoc): Promise<FileResult>;
  backupLibrary(): Promise<FileResult & { count?: number }>;
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

const SUPPORT_EMAIL = 'csuter@snydersace.net';

export function supportMailto(kind: 'bug' | 'feature', detail: string): string {
  const label = kind === 'bug' ? 'Bug report' : 'Feature request';
  const subject = `Ace Document Studio — ${label}`;
  const body =
    kind === 'bug'
      ? `What happened?\n\n\nWhat did you expect?\n\n\nSteps to see it again:\n1. \n2. \n\n${detail}`
      : `What should the app do?\n\n\nWhy it helps the store:\n\n\n${detail}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

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
  openSupport(kind) {
    window.location.href = supportMailto(kind, 'Sent from the browser build.');
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
};

export const api: StudioApi = window.aps ?? browserApi;
