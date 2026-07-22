import type { PolicyDoc } from './model/types';

export interface StudioApi {
  isElectron: boolean;
  listDocs(): Promise<PolicyDoc[]>;
  saveDoc(doc: PolicyDoc): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  exportPdf(id: string, title: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  printDoc(id: string): Promise<{ ok: boolean; error?: string }>;
  printReady(): void;
  onMenu(handler: (cmd: string) => void): () => void;
  onUpdateStatus?(handler: (text: string) => void): () => void;
}

declare global {
  interface Window {
    aps?: StudioApi;
  }
}

// Browser fallback (dev server / tests): documents live in localStorage,
// print/PDF go through the browser's own print dialog.
const LS_KEY = 'aps.docs.v1';

function readAll(): Record<string, PolicyDoc> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, PolicyDoc>): void {
  localStorage.setItem(LS_KEY, JSON.stringify(map));
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
};

export const api: StudioApi = window.aps ?? browserApi;
