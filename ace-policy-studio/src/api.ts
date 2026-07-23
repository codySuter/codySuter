import type { PolicyDoc } from './model/types';

export interface SupportTicket {
  category: 'Bug' | 'Issue' | 'Feature idea';
  message: string;
  expected: string;
  reporter: string;
}

export interface SupportResult {
  ok: boolean;
  opened?: boolean;
  reportPath?: string;
  email: string;
  error?: string;
}

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
  supportTicket(ticket: SupportTicket): Promise<SupportResult>;
  logError?(text: string): void;
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
  async supportTicket(ticket) {
    const email = 'csuter@snydersace.net';
    const subject = `[Ace Policy Studio] ${ticket.category}: ${ticket.message.slice(0, 60)}`;
    const body = [
      `Category: ${ticket.category}`,
      ticket.reporter ? `Reported by: ${ticket.reporter}` : '',
      '',
      'What happened:',
      ticket.message,
      ...(ticket.expected ? ['', 'What was expected:', ticket.expected] : []),
      '',
      '(Diagnostics and logs are attached automatically only from the installed Windows app.)',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      window.open(
        `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      );
    } catch {
      // No mail handler in this browser — the confirmation screen covers it.
    }
    return { ok: true, opened: true, email };
  },
  logError(text) {
    console.error('[aps]', text);
  },
};

export const api: StudioApi = window.aps ?? browserApi;
