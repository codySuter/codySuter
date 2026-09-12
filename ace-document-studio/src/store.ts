import { create } from 'zustand';
import { api } from './api';
import {
  cloneBlock,
  containerOf,
  findBlockDeep,
  newBlock,
  topLevelIndexOf,
  uid,
} from './model/blocks';
import { replaceAll, replaceMatch, type FindMatch } from './model/find';
import { normalizeDoc } from './model/normalize';
import { starterDocs } from './model/starter';
import { documentFromTemplate, newDocument } from './model/templates';
import type { Block, BlockAlign, BlockType, ColumnChildType, StudioDoc } from './model/types';
import { MIN_TABLE_COL_PCT } from './model/types';

export type Route =
  | { name: 'boot' }
  | { name: 'library' }
  | { name: 'editor'; id: string }
  | { name: 'print'; id: string }
  | { name: 'compile'; ids: string[]; title: string; toc: boolean };

export type SaveState = 'saved' | 'saving' | 'dirty';
export type Zoom = 'fit' | 1 | 1.25 | 1.5;

/** App-level overlays; opened from buttons and the native menu alike. */
export type ModalName =
  | 'templates'
  | 'shortcuts'
  | 'history'
  | 'backups'
  | 'saveTemplate'
  | 'sync'
  | null;

export interface FocusedCell {
  blockId: string;
  row: number; // -1 = header row
  col: number;
}

const SEED_FLAG = 'aps.seeded.v1';
const HISTORY_CAP = 100;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastHistKey: string | null = null;

interface StoreState {
  route: Route;
  docs: StudioDoc[];
  current: StudioDoc | null;
  selectedId: string | null;
  past: StudioDoc[];
  future: StudioDoc[];
  saveState: SaveState;
  status: string;
  statusAction: { label: string; run: () => void } | null;
  dragging: 'palette' | 'block' | null;
  contentH: number;
  zoom: Zoom;
  modal: ModalName;
  focusedCell: FocusedCell | null;

  init(): Promise<void>;
  toLibrary(): Promise<void>;
  openDoc(id: string): Promise<void>;
  loadPrint(id: string): Promise<void>;
  loadCompile(ids: string[], title: string, toc: boolean): Promise<void>;
  createNewDoc(from?: StudioDoc): Promise<void>;
  deleteDoc(id: string): Promise<void>;
  duplicateDoc(id: string): Promise<void>;
  renameDoc(id: string, titleHtml: string): Promise<void>;

  mutate(fn: (doc: StudioDoc) => void, histKey?: string): void;
  saveNow(): Promise<void>;
  undo(): void;
  redo(): void;
  breakHistory(): void;

  select(id: string | null): void;
  setDragging(d: 'palette' | 'block' | null): void;
  setContentH(h: number): void;
  setZoom(z: Zoom): void;
  setStatus(s: string): void;
  setStatusAction(s: string, action: { label: string; run: () => void } | null): void;
  setModal(m: ModalName): void;
  setFocusedCell(c: FocusedCell | null): void;

  setDocField<K extends keyof StudioDoc>(field: K, value: StudioDoc[K], histKey?: string): void;
  updateBlock(id: string, patch: Partial<Block>, histKey?: string): void;
  insertBlock(type: BlockType, index?: number, aboveHeader?: boolean): void;
  insertBlocks(blocks: Block[], index?: number, aboveHeader?: boolean): void;
  removeBlock(id: string): void;
  duplicateBlock(id: string): void;
  pasteBlock(block: Block): void;
  insertBlocksAfter(id: string, blocks: Block[]): void;
  moveBlockTo(activeId: string, overId: string): void;
  moveHeaderTo(index: number): void;
  moveBlockToHeader(activeId: string): void;
  moveBlockBy(id: string, delta: number): void;
  setListItem(id: string, index: number, html: string, histKey?: string): void;
  addListItem(id: string, afterIndex: number): void;
  addListItems(id: string, afterIndex: number, items: string[]): void;
  removeListItem(id: string, index: number): void;
  setCell(id: string, row: number, col: number, html: string, histKey?: string): void;
  tableInsertRow(id: string, at: number): void;
  tableRemoveRow(id: string, at: number): void;
  tableInsertCol(id: string, at: number): void;
  tableRemoveCol(id: string, at: number): void;
  tableSetAlign(id: string, col: number, align: BlockAlign): void;
  tableSetWidths(id: string, widths: number[], histKey?: string): void;

  addColumnChild(columnsId: string, side: 'left' | 'right', type: ColumnChildType): void;
  setColumnHeading(columnsId: string, side: 'left' | 'right', html: string, histKey?: string): void;
  addSignLine(id: string, withDate: boolean): void;
  removeSignLine(id: string, index: number): void;
  setSignLineLabel(id: string, index: number, html: string, histKey?: string): void;

  replaceCurrent(doc: StudioDoc, statusMsg: string): void;
  runReplaceOne(match: FindMatch, query: string, replacement: string): boolean;
  runReplaceAll(query: string, replacement: string): number;
}

const findBlock = findBlockDeep;

export const useStore = create<StoreState>((set, get) => ({
  route: { name: 'boot' },
  docs: [],
  current: null,
  selectedId: null,
  past: [],
  future: [],
  saveState: 'saved',
  status: 'Welcome to Ace Document Studio.',
  statusAction: null,
  dragging: null,
  contentH: 0,
  zoom: 'fit',
  modal: null,
  focusedCell: null,

  async init() {
    const compile = window.location.hash.match(/^#\/compile\/([^?]+)(?:\?(.*))?$/);
    if (compile) {
      const params = new URLSearchParams(compile[2] ?? '');
      await get().loadCompile(
        decodeURIComponent(compile[1]).split(',').filter(Boolean),
        params.get('title') ?? 'Store Documents',
        params.get('toc') !== '0',
      );
      return;
    }
    const m = window.location.hash.match(/^#\/print\/(.+)$/);
    if (m) {
      await get().loadPrint(decodeURIComponent(m[1]));
      return;
    }
    await get().toLibrary();
  },

  async toLibrary() {
    if (get().saveState !== 'saved') await get().saveNow();
    let docs = (await api.listDocs()).map(normalizeDoc);
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
      statusAction: null,
      modal: null,
      focusedCell: null,
    });
    window.location.hash = '#/library';
  },

  async openDoc(id) {
    let doc = get().docs.find((d) => d.id === id);
    if (!doc) doc = (await api.listDocs()).map(normalizeDoc).find((d) => d.id === id);
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
      statusAction: null,
      modal: null,
      focusedCell: null,
    });
    window.location.hash = `#/editor/${id}`;
  },

  async loadPrint(id) {
    const docs = (await api.listDocs()).map(normalizeDoc);
    const doc = docs.find((d) => d.id === id) ?? null;
    set({ route: { name: 'print', id }, current: doc, docs });
  },

  async loadCompile(ids, title, toc) {
    const docs = (await api.listDocs()).map(normalizeDoc);
    set({ route: { name: 'compile', ids, title, toc }, current: null, docs });
  },

  async createNewDoc(from) {
    const doc = documentFromTemplate(from ?? newDocument());
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
      status: 'New document — click the title to name it, and edit any text on the page.',
      statusAction: null,
      modal: null,
      focusedCell: null,
    });
    window.location.hash = `#/editor/${doc.id}`;
  },

  async deleteDoc(id) {
    const doc = get().docs.find((d) => d.id === id);
    await api.deleteDoc(id);
    set({ docs: get().docs.filter((d) => d.id !== id) });
    if (!doc) {
      set({ status: 'Document deleted.', statusAction: null });
      return;
    }
    // Soft delete: the file moved to the trash (desktop) and the document
    // stays restorable right from the status bar.
    get().setStatusAction(`Deleted “${doc.title || 'Untitled'}”.`, {
      label: 'Undo',
      run: () => {
        void (async () => {
          await api.saveDoc(doc);
          set({
            docs: [doc, ...get().docs.filter((d) => d.id !== doc.id)],
            status: `Restored “${doc.title || 'Untitled'}”.`,
            statusAction: null,
          });
        })();
      },
    });
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

  async renameDoc(id, titleHtml) {
    const doc = get().docs.find((d) => d.id === id);
    if (!doc) return;
    const renamed = { ...doc, title: titleHtml, updatedAt: Date.now() };
    await api.saveDoc(renamed);
    set({
      docs: get().docs.map((d) => (d.id === id ? renamed : d)),
      status: 'Document renamed.',
    });
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

  // Ends the current history-coalescing run (called when a field blurs)
  // so each editing session is its own undo step.
  breakHistory() {
    lastHistKey = null;
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
    set({ status: s, statusAction: null });
  },
  setStatusAction(s, action) {
    set({ status: s, statusAction: action });
  },
  setModal(m) {
    set({ modal: m });
  },
  setFocusedCell(c) {
    set({ focusedCell: c });
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

  insertBlock(type, index, aboveHeader) {
    get().insertBlocks([newBlock(type)], index, aboveHeader);
    set({ status: 'Block added — click its text to edit.' });
  },

  insertBlocks(blocks, index, aboveHeader) {
    if (blocks.length === 0) return;
    get().mutate((doc) => {
      const h = doc.headerAt ?? 0;
      const i =
        index === undefined ? doc.blocks.length : Math.max(0, Math.min(index, doc.blocks.length));
      // A block landing inside the above-header run stays above the header.
      const above = aboveHeader ?? (h > 0 && i <= h);
      doc.blocks.splice(i, 0, ...blocks);
      if (above && i <= h) doc.headerAt = h + blocks.length;
    });
    set({ selectedId: blocks[0].id });
  },

  removeBlock(id) {
    get().mutate((doc) => {
      const arr = containerOf(doc, id);
      if (!arr) return;
      const i = arr.findIndex((b) => b.id === id);
      arr.splice(i, 1);
      if (arr === doc.blocks && i < (doc.headerAt ?? 0)) {
        doc.headerAt = (doc.headerAt ?? 0) - 1;
        if (doc.headerAt === 0) delete doc.headerAt;
      }
    });
    if (get().selectedId === id) set({ selectedId: null });
    set({ status: 'Block removed.' });
  },

  duplicateBlock(id) {
    let newId: string | null = null;
    get().mutate((doc) => {
      const arr = containerOf(doc, id);
      if (!arr) return;
      const i = arr.findIndex((b) => b.id === id);
      const copy = cloneBlock(arr[i]);
      newId = copy.id;
      arr.splice(i + 1, 0, copy);
      if (arr === doc.blocks && i + 1 <= (doc.headerAt ?? 0)) {
        doc.headerAt = (doc.headerAt ?? 0) + 1;
      }
    });
    if (newId) set({ selectedId: newId, status: 'Block duplicated.' });
  },

  // Paste a block copied to the clipboard — after the selection, or at the end.
  pasteBlock(block) {
    const st = get();
    const doc = st.current;
    if (!doc) return;
    const copy = cloneBlock(block);
    const sel = st.selectedId;
    const idx = sel ? topLevelIndexOf(doc, sel) + 1 : doc.blocks.length;
    st.insertBlocks([copy], idx > 0 ? idx : doc.blocks.length);
    set({ status: 'Block pasted.' });
  },

  // Insert blocks right after an existing one, wherever it lives (top
  // level or inside a column). Used by multi-line paragraph paste.
  insertBlocksAfter(id, blocks) {
    if (blocks.length === 0) return;
    get().mutate((doc) => {
      const arr = containerOf(doc, id);
      if (!arr) return;
      const i = arr.findIndex((b) => b.id === id);
      arr.splice(i + 1, 0, ...blocks);
      if (arr === doc.blocks && i + 1 <= (doc.headerAt ?? 0)) {
        doc.headerAt = (doc.headerAt ?? 0) + blocks.length;
      }
    });
  },

  moveBlockTo(activeId, overId) {
    get().mutate((doc) => {
      const arr = containerOf(doc, activeId);
      if (!arr || !arr.some((b) => b.id === overId)) return;
      const from = arr.findIndex((b) => b.id === activeId);
      const to = arr.findIndex((b) => b.id === overId);
      if (from === -1 || to === -1 || from === to) return;
      // Crossing the title header adjusts how many blocks sit above it.
      if (arr === doc.blocks) {
        const h = doc.headerAt ?? 0;
        const fromAbove = from < h;
        const toAbove = to < h;
        const next = h - (fromAbove ? 1 : 0) + (toAbove ? 1 : 0);
        if (next === 0) delete doc.headerAt;
        else doc.headerAt = next;
      }
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
    });
  },

  // A block dropped onto the title header lands directly above it.
  moveBlockToHeader(activeId) {
    get().mutate((doc) => {
      const from = doc.blocks.findIndex((b) => b.id === activeId);
      if (from === -1) return;
      const h = doc.headerAt ?? 0;
      const target = h - (from < h ? 1 : 0);
      const [moved] = doc.blocks.splice(from, 1);
      doc.blocks.splice(target, 0, moved);
      doc.headerAt = target + 1;
    });
  },

  // Place the draggable title header so that `index` top-level blocks
  // render above it.
  moveHeaderTo(index) {
    get().mutate((doc) => {
      const next = Math.max(0, Math.min(doc.blocks.length, index));
      if (next === 0) delete doc.headerAt;
      else doc.headerAt = next;
    });
  },

  // Works at the top level and inside a column: the block moves within
  // whatever array contains it. At the top level, a block adjacent to the
  // title header steps across it instead of jumping past it.
  moveBlockBy(id, delta) {
    get().mutate((doc) => {
      const arr = containerOf(doc, id);
      if (!arr) return;
      const from = arr.findIndex((b) => b.id === id);
      if (from === -1) return;
      if (arr === doc.blocks) {
        const h = doc.headerAt ?? 0;
        if (delta > 0 && from === h - 1) {
          // Just above the header, moving down → slide below the header.
          if (h - 1 === 0) delete doc.headerAt;
          else doc.headerAt = h - 1;
          return;
        }
        if (delta < 0 && from === h && h < doc.blocks.length) {
          // First block below the header, moving up → slide above it.
          doc.headerAt = h + 1;
          return;
        }
      }
      const to = from + delta;
      if (to < 0 || to >= arr.length) return;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
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

  // Multi-line paste into a list: the extra lines become items of their own.
  addListItems(id, afterIndex, items) {
    if (items.length === 0) return;
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && 'items' in b) b.items.splice(afterIndex + 1, 0, ...items);
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

  tableInsertRow(id, at) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table') return;
      const i = Math.max(0, Math.min(at, b.rows.length));
      b.rows.splice(i, 0, b.header.map(() => ''));
    });
  },

  tableRemoveRow(id, at) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table' || b.rows.length <= 1) return;
      if (at < 0 || at >= b.rows.length) return;
      b.rows.splice(at, 1);
    });
    set({ focusedCell: null });
  },

  tableInsertCol(id, at) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table') return;
      const i = Math.max(0, Math.min(at, b.header.length));
      b.header.splice(i, 0, '');
      b.rows.forEach((r) => r.splice(i, 0, ''));
      if (b.aligns) b.aligns.splice(i, 0, 'left');
      if (b.widths) {
        // Give the new column an equal share and re-normalize to 100.
        b.widths.splice(i, 0, 100 / b.header.length);
        const sum = b.widths.reduce((a, w) => a + w, 0);
        b.widths = b.widths.map((w) => Math.max(MIN_TABLE_COL_PCT, (w / sum) * 100));
      }
    });
  },

  tableRemoveCol(id, at) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table' || b.header.length <= 1) return;
      if (at < 0 || at >= b.header.length) return;
      b.header.splice(at, 1);
      b.rows.forEach((r) => r.splice(at, 1));
      if (b.aligns) b.aligns.splice(at, 1);
      if (b.widths) {
        b.widths.splice(at, 1);
        const sum = b.widths.reduce((a, w) => a + w, 0);
        b.widths = b.widths.map((w) => (w / sum) * 100);
      }
    });
    set({ focusedCell: null });
  },

  tableSetAlign(id, col, align) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table' || col < 0 || col >= b.header.length) return;
      const aligns = b.aligns ?? b.header.map(() => 'left' as BlockAlign);
      aligns[col] = align;
      if (aligns.every((a) => a === 'left')) delete b.aligns;
      else b.aligns = aligns;
    });
  },

  tableSetWidths(id, widths, histKey) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (!b || b.type !== 'table' || widths.length !== b.header.length) return;
      b.widths = widths.map((w) => Math.max(MIN_TABLE_COL_PCT, Math.round(w * 10) / 10));
    }, histKey);
  },

  addColumnChild(columnsId, side, type) {
    const child = newBlock(type);
    get().mutate((doc) => {
      const b = findBlock(doc, columnsId);
      if (b && b.type === 'columns') b[side].blocks.push(child);
    });
    set({ selectedId: child.id });
  },

  setColumnHeading(columnsId, side, html, histKey) {
    get().mutate((doc) => {
      const b = findBlock(doc, columnsId);
      if (b && b.type === 'columns') b[side].heading = html;
    }, histKey);
  },

  addSignLine(id, withDate) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && b.type === 'signoff') {
        b.lines.push({
          label: withDate ? 'Employee signature' : 'Printed name',
          withDate,
        });
      }
    });
  },

  removeSignLine(id, index) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && b.type === 'signoff' && b.lines.length > 1) b.lines.splice(index, 1);
    });
  },

  setSignLineLabel(id, index, html, histKey) {
    get().mutate((doc) => {
      const b = findBlock(doc, id);
      if (b && b.type === 'signoff' && b.lines[index]) b.lines[index].label = html;
    }, histKey);
  },

  // Swap the open document's content for another saved state (a restored
  // revision). Runs through mutate, so it lands on the undo stack too.
  replaceCurrent(doc, statusMsg) {
    get().mutate((cur) => {
      const restored = structuredClone(doc);
      restored.id = cur.id;
      // Clear optionals the snapshot may not carry, then copy everything over.
      delete cur.headerAt;
      delete cur.audience;
      Object.assign(cur, restored);
    });
    set({ selectedId: null, status: statusMsg });
  },

  runReplaceOne(match, query, replacement) {
    let ok = false;
    get().mutate((doc) => {
      ok = replaceMatch(doc, match, query, replacement);
    });
    return ok;
  },

  runReplaceAll(query, replacement) {
    let n = 0;
    get().mutate((doc) => {
      n = replaceAll(doc, query, replacement);
    });
    return n;
  },
}));
