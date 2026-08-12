import type { BayMap } from './model/types';
import { looksLikeMap } from './model/layout';

export type FileResult = { ok: boolean; path?: string; canceled?: boolean; error?: string };
export type PickedFile = { ok: boolean; name?: string; text?: string; canceled?: boolean; error?: string };

export interface BayApi {
  isElectron: boolean;
  loadMap(): Promise<BayMap | null>;
  saveMap(map: BayMap): Promise<void>;
  /** Open dialog / file picker; returns the file's text. */
  pickFile(kind: 'csv' | 'json'): Promise<PickedFile>;
  /** Save dialog / browser download. */
  saveFile(defaultName: string, text: string, kind: 'csv' | 'json'): Promise<FileResult>;
  onMenu(handler: (cmd: string) => void): () => void;
  onUpdate(handler: (version: string) => void): () => void;
  openSupport(kind: 'bug' | 'feature'): void;
}

declare global {
  interface Window {
    abs?: BayApi;
  }
}

const SUPPORT_EMAIL = 'csuter@snydersace.net';

export function supportMailto(kind: 'bug' | 'feature', detail: string): string {
  const label = kind === 'bug' ? 'Bug report' : 'Feature request';
  const subject = `Ace Bay Studio — ${label}`;
  const body =
    kind === 'bug'
      ? `What happened?\n\n\nWhat did you expect?\n\n\nSteps to see it again:\n1. \n2. \n\n${detail}`
      : `What should the app do?\n\n\nWhy it helps the store:\n\n\n${detail}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Browser fallback (dev server / tests): the map lives in localStorage,
// files go through a picker and downloads.
const LS_KEY = 'abs.map.v1';

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

const browserApi: BayApi = {
  isElectron: false,
  async loadMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
      return looksLikeMap(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async saveMap(map) {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  },
  async pickFile(kind) {
    const file = await pickBrowserFile(kind === 'csv' ? '.csv,text/csv' : '.json,application/json');
    if (!file) return { ok: false, canceled: true };
    return { ok: true, name: file.name, text: await file.text() };
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

export const api: BayApi = window.abs ?? browserApi;
