import type { FloorDoc } from './model/types';
import { looksLikeDoc } from './model/types';

export type FileResult = { ok: boolean; path?: string; canceled?: boolean; error?: string };
/** bytes is base64 so the same shape crosses the Electron IPC bridge. */
export type PickedFile = { ok: boolean; name?: string; bytes?: string; canceled?: boolean; error?: string };

export interface FloorApi {
  isElectron: boolean;
  loadDoc(): Promise<FloorDoc | null>;
  saveDoc(doc: FloorDoc): Promise<void>;
  /** Open dialog / file picker; 'import' takes .csv/.xlsx, 'json' backups. */
  pickFile(kind: 'import' | 'json'): Promise<PickedFile>;
  /** Save dialog / browser download. */
  saveFile(defaultName: string, text: string, kind: 'csv' | 'json'): Promise<FileResult>;
  onMenu(handler: (cmd: string) => void): () => void;
  onUpdate(handler: (version: string) => void): () => void;
  openSupport(kind: 'bug' | 'feature'): void;
}

declare global {
  interface Window {
    afs?: FloorApi;
  }
}

const SUPPORT_EMAIL = 'csuter@snydersace.net';

export function supportMailto(kind: 'bug' | 'feature', detail: string): string {
  const label = kind === 'bug' ? 'Bug report' : 'Feature request';
  const subject = `Ace Floor Studio — ${label}`;
  const body =
    kind === 'bug'
      ? `What happened?\n\n\nWhat did you expect?\n\n\nSteps to see it again:\n1. \n2. \n\n${detail}`
      : `What should the app do?\n\n\nWhy it helps the store:\n\n\n${detail}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Browser fallback (dev server / tests): the doc lives in localStorage,
// files go through a picker and downloads.
const LS_KEY = 'afs.doc.v1';

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const browserApi: FloorApi = {
  isElectron: false,
  async loadDoc() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
      return looksLikeDoc(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async saveDoc(doc) {
    localStorage.setItem(LS_KEY, JSON.stringify(doc));
  },
  async pickFile(kind) {
    const file = await pickBrowserFile(
      kind === 'import' ? '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.json,application/json',
    );
    if (!file) return { ok: false, canceled: true };
    return { ok: true, name: file.name, bytes: bytesToB64(new Uint8Array(await file.arrayBuffer())) };
  },
  async saveFile(defaultName, text, kind) {
    download(defaultName, text, kind === 'csv' ? 'text/csv' : 'application/json');
    return { ok: true };
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
};

export const api: FloorApi = window.afs ?? browserApi;
