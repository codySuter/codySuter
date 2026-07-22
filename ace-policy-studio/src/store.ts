import { create } from 'zustand';
import { api } from './api';
import { cloneBlock, newBlock, uid } from './model/blocks';
import { starterDocs } from './model/starter';
import { generateDoc, type WizardAnswers } from './model/templates';
import type { Block, BlockType, PolicyDoc } from './model/types';

export type Route =
  | { name: 'boot' }
  | { name: 'library' }
  | { name: 'wizard' }
  | { name: 'editor'; id: string }
  | { name: 'print'; id: string };

export type SaveState = 'saved' | 'saving' | 'dirty';
export type Zoom = 'fit' | 1 | 1.25 | 1.5;

const SEED_FLAG = 'aps.seeded.v1';
const HISTORY_CAP = 100;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastHistKey: string | null = null;

interface StoreState {
  route: Route;
  docs: PolicyDoc[];
  current: PolicyDoc | null;
  selectedId: string | null;
  past: PolicyDoc[];
  future: PolicyDoc[];
  saveState: SaveState;
  status: string;
  dragging: 'palette' | 'block' | null;
  contentH: number;
  zoom: Zoom;

  init(): Promise<void>;
  toLibrary(): Promise<void>;
  toWizard(): void;
  openDoc(id: string): Promise<void>;
  loadPrint(id: string): Promise<void>;
  createFromWizard(answers: WizardAnswers): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  duplicateDoc(id: string): Promise<void>;

  mutate(fn: (doc: PolicyDoc) => void, histKey?: string): void;
  saveNow(): Promise<void>;
  undo(): void;
  redo(): void;

  select(id: string | null): void;
  setDragging(d: 'palette' | 'block' | null): void;
  setContentH(h: number): void;
  setZoom(z: Zoom): void;
  setStatus(s: string): void;

  setDocField<K extends keyof PolicyDoc>(field: K, value: PolicyDoc[K], histKey?: string): void;
  updateBlock(id: string, patch: Partial<Block>, histKey?: string): void;
  insertBlock(type: BlockType, index?: number): void;
  removeBlock(id: string): void;
  duplicateBlock(id: string): void;
  moveBlockTo(activeId: string, overId: string): void;
  moveBlockBy(id: string, delta: number): void;
  setListItem(id: string, index: number, html: string, histKey?: string): void;
  addListItem(id: string, afterIndex: number): void;
  removeListItem(id: string, index: number): void;
  setCell(id: string, row: number, col: number, html: string, histKey?: string): void;
  tableOp(id: string, op: 'addRow' | 'removeRow' | 'addCol' | 'removeCol'): void;
}

function findBlock(doc: PolicyDoc, id: string): Block | undefined {
  return doc.blocks.find((b) => b.id === id);
}

export const useStore = create<StoreState>((set, get) => ({
  route: { name: 'boot' },
  docs: [],
  current: null,
  selectedId: null,
  past: [],
  future: [],
  saveState: 'saved',
  status: 'Welcome to Ace Policy Studio.',
  dragging: null,
  contentH: 0,
  zoom: 'fit',

  async init() {
    const m = window.location.hash.match(/^#\/print\/(.+)$/);
    if (m) {
      await get().loadPrint(decodeURIComponent(m[1]));
      return;
    }
    await get().toLibrary();
  },

  async toLibrary() {
    if (get().saveState !== 'saved') await get().saveNow();
    let docs = await api.listDocs();
    if (docs.length === 0 && !localStorage.getItem(SEED_FLAG)) {
      const starters = starterDocs();
      for (const d of starters) await api.saveDoc(d);
      localStorage.setItem(SEED_FLAG, '1');
      docs = starters;
    }
    lastHistKey = null;
    set({
      route: { name: 'library' },
      docs,
      current: null,
      selectedId: null,
      past: [],
      future: [],
      saveState: 'saved',
      status: `${docs.length} document${docs.length === 1 ? '' : 's'} in your library.`,
    });
    window.location.hash = '#/library';
  },

  toWizard() {
    set({ route: { name: 'wizard' }, status: 'Let’s set up a new document.' });
    window.location.hash = '#/new';
  },

  async openDoc(id) {
    let doc = get().docs.find((d) => d.id === id);
    if (!doc) doc = (await api.listDocs()).find((d) => d.id === id);
    if (!doc) return;
    lastHistKey = null;
    set({
      route: { name: 'editor', id },
      current: structuredClone(doc),
      selectedId: null,
      past: [],
      future: [],
      saveState: 'saved',
      status: `Opened “${doc.title}”.`,
    });
    window.location.hash = `#/editor/${id}`;
  },

  async loadPrint(id) {
    const docs = await api.listDocs();
    const doc = docs.find((d) => d.id === id) ?? null;
    set({ route: { name: 'print', id }, current: doc, docs });
  },

  async createFromWizard(answers) {
    const doc = generateDoc(answers);
    await api.saveDoc(doc);
    lastHistKey = null;
    set({
      docs: [doc, ...get().docs],
      route: { name: 'editor', id: doc.id },
      current: structuredClone(doc),
      selectedId: null,
      past: [],
      future: [],
      saveState: 'saved',
      status: `Created “${doc.title}” — click any text to edit it.`,
    });
    window.location.hash = `#/editor/${doc.id}`;
  },

  async deleteDoc(id) {
    await api.deleteDoc(id);
    set({ docs: get().docs.filter((d) => d.id !== id), status: 'Document deleted.' });
  },

  async duplicateDoc(id) {
    const src = get().docs.find((d) => d.id === id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.id = uid();
    copy.title = `${copy.title} (copy)`;
    copy.blocks = copy.blocks.map((b) => cloneBlock(b));
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    await api.saveDoc(copy);
    set({ docs: [copy, ...get().docs], status: `Duplicated “${src.title}”.` });
  },

  mutate(fn, histKey) {
    const cur = get().current;
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    next.updatedAt = Date.now();
    let past = get().past;
    if (!histKey || histKey !== lastHistKey) {
      past = [...past.slice(-(HISTORY_CAP - 1)), structuredClone(cur)];
    }
    lastHistKey = histKey ?? null;
    set({ current: next, past, future: [], saveState: 'dirty' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), 700);
  },

  async saveNow() {
    const cur = get().current;
    if (!cur || get().saveState === 'saved') return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({ saveState: 'saving' });
    try {
      await api.saveDoc(cur);
      const docs = get().docs.some((d) => d.id === cur.id)
        ? get().docs.map((d) => (d.id === cur.id ? cur : d))
        : [cur, ...get().docs];
      set({ saveState: get().current === cur ? 'saved' : 'dirty', docs });
    } catch (err) {
      set({ status: `Save failed: ${String(err)}` });
    }
  },

  undo() {
    const { past, current, future } = get();
    if (!current || past.length === 0) return;
    const prev = past[past.length - 1];
    lastHistKey = null;
    set({
      past: past.slice(0, -1),
      current: prev,
      future: [current, ...future].slice(0, HISTORY_CAP),
      saveState: 'dirty',
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), 700);
  },

  redo() {
    const { past, current, future } = get();
    if (!current || future.length === 0) return;
    const next = future[0];
    lastHistKey = null;
    set({
      past: [...past, current].slice(-HISTORY_CAP),
      current: next,
      future: future.slice(1),
      saveState: 'dirty',
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), 700);
  },

  select(id) {
    set({ selectedId: id });
  },
  setDragging(d) {
    set({ dragging: d });
  },
  setContentH(h) {
    if (Math.abs(h - get().contentH) > 0.5) set({ contentH: h });
  },
  setZoom(z) {
    set({ zoom: z });
  },
  setStatus(s) {
    set({ status: s });
  },

  setDocField(field, value, histKey) {
    get().mutate((doc) => {
      doc[field] = value;
    }, histKey);
  },

  updateBlock(id, patch, histKey) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b) Object.assign(b, patch);
    }, histKey);
  },

  insertBlock(type, index) {
    const block = newBlock(type);
    get().mutate((doc) => {
      const i = index === undefined ? doc.blocks.length : Math.max(0, Math.min(index, doc.blocks.length));
      doc.blocks.splice(i, 0, block);
    });
    set({ selectedId: block.id, status: 'Block added — click its text to edit.' });
  },

  removeBlock(id) {
    get().mutate((doc) => {
      doc.blocks = doc.blocks.filter((b) => b.id !== id);
    });
    if (get().selectedId === id) set({ selectedId: null });
    set({ status: 'Block removed.' });
  },

  duplicateBlock(id) {
    let newId: string | null = null;
    get().mutate((doc) => {
      const i = doc.blocks.findIndex((b) => b.id === id);
      if (i === -1) return;
      const copy = cloneBlock(doc.blocks[i]);
      newId = copy.id;
      doc.blocks.splice(i + 1, 0, copy);
    });
    if (newId) set({ selectedId: newId, status: 'Block duplicated.' });
  },

  moveBlockTo(activeId, overId) {
    get().mutate((doc) => {
      const from = doc.blocks.findIndex((b) => b.id === activeId);
      const to = doc.blocks.findIndex((b) => b.id === overId);
      if (from === -1 || to === -1 || from === to) return;
      const [moved] = doc.blocks.splice(from, 1);
      doc.blocks.splice(to, 0, moved);
    });
  },

  moveBlockBy(id, delta) {
    get().mutate((doc) => {
      const from = doc.blocks.findIndex((b) => b.id === id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= doc.blocks.length) return;
      const [moved] = doc.blocks.splice(from, 1);
      doc.blocks.splice(to, 0, moved);
    });
  },

  setListItem(id, index, html, histKey) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && 'items' in b && b.items[index] !== undefined) b.items[index] = html;
    }, histKey);
  },

  addListItem(id, afterIndex) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && 'items' in b) b.items.splice(afterIndex + 1, 0, '');
    });
  },

  removeListItem(id, index) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && 'items' in b && b.items.length > 1) b.items.splice(index, 1);
    });
  },

  setCell(id, row, col, html, histKey) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table') return;
      if (row === -1) b.header[col] = html;
      else if (b.rows[row]) b.rows[row][col] = html;
    }, histKey);
  },

  tableOp(id, op) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table') return;
      if (op === 'addRow') b.rows.push(b.header.map(() => ''));
      if (op === 'removeRow' && b.rows.length > 1) b.rows.pop();
      if (op === 'addCol') {
        b.header.push('');
        b.rows.forEach((r) => r.push(''));
      }
      if (op === 'removeCol' && b.header.length > 1) {
        b.header.pop();
        b.rows.forEach((r) => r.pop());
      }
    });
  },
}));
