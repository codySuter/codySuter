import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  AlignLeft,
  ArrowLeft,
  FileDown,
  Heading1,
  Image as ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  PenLine,
  Printer,
  Redo2,
  Table as TableIcon,
  Tag,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { BLOCK_LABELS } from '../model/blocks';
import { plainText } from '../model/sanitize';
import type { Block, BlockType } from '../model/types';
import { ACCENT_PRESETS, PRINTABLE_H_PX } from '../model/types';
import { useStore, type Zoom } from '../store';
import { toggleHighlightSelection } from './Editable';
import { PageView } from './PageView';
import { AppHeader, Btn, Panel, Seg, Swatches } from './ui';

const PALETTE: { type: BlockType; icon: React.ReactNode }[] = [
  { type: 'section', icon: <Heading1 size={15} /> },
  { type: 'paragraph', icon: <AlignLeft size={15} /> },
  { type: 'badgeRow', icon: <Tag size={15} /> },
  { type: 'bullets', icon: <List size={15} /> },
  { type: 'steps', icon: <ListOrdered size={15} /> },
  { type: 'checklist', icon: <ListChecks size={15} /> },
  { type: 'callout', icon: <TriangleAlert size={15} /> },
  { type: 'table', icon: <TableIcon size={15} /> },
  { type: 'signoff', icon: <PenLine size={15} /> },
  { type: 'image', icon: <ImageIcon size={15} /> },
];

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

function PaletteTile({ type, icon }: { type: BlockType; icon: React.ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `new:${type}` });
  const insertBlock = useStore((s) => s.insertBlock);

  const addByClick = () => {
    const st = useStore.getState();
    const sel = st.selectedId;
    const idx =
      st.current && sel ? st.current.blocks.findIndex((b) => b.id === sel) + 1 : 0;
    insertBlock(type, idx > 0 ? idx : undefined);
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      data-testid={`palette-${type}`}
      onClick={addByClick}
      title={`${BLOCK_LABELS[type]} — click to add, or drag onto the page`}
      className="flex cursor-grab items-center gap-2 rounded-[6px] border border-[#DDE0E3] bg-white px-2 py-[7px] text-left text-[12px] font-medium text-[#20242B] hover:border-[#C8102E] hover:text-[#C8102E] active:cursor-grabbing"
    >
      <span className="text-[#8A9099]">{icon}</span>
      {BLOCK_LABELS[type]}
    </button>
  );
}

function FitMeter() {
  const contentH = useStore((s) => s.contentH);
  const pct = contentH / PRINTABLE_H_PX;
  const pages = Math.max(1, Math.ceil(pct));
  const fits = pages <= 1;
  return (
    <div className="flex items-center gap-2" title="Live page-fit for letter paper at 0.4″ margins">
      <div className="h-[7px] w-[110px] overflow-hidden rounded-full bg-[#E1E3E6]">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            background: fits ? '#005238' : '#C8102E',
          }}
        />
      </div>
      <span
        data-testid="fit-label"
        className={fits ? 'text-[#005238]' : 'font-semibold text-[#C8102E]'}
      >
        {fits
          ? `Fits on one page · ${Math.round(pct * 100)}% full`
          : `Runs onto page ${pages} — trim or tighten`}
      </span>
    </div>
  );
}

function Inspector({ block }: { block: Block }) {
  const updateBlock = useStore((s) => s.updateBlock);
  const addListItem = useStore((s) => s.addListItem);
  const tableOp = useStore((s) => s.tableOp);

  switch (block.type) {
    case 'section':
      return <p className="text-[11.5px] text-[#6D6E71]">Sections number themselves — drag to reorder and the numbers follow.</p>;
    case 'paragraph':
      return (
        <label className="flex items-center gap-2 text-[12px] text-[#20242B]">
          <input
            type="checkbox"
            checked={block.muted}
            onChange={(e) => updateBlock(block.id, { muted: e.target.checked })}
          />
          Gray intro styling (bold stays dark)
        </label>
      );
    case 'badgeRow':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-[#6D6E71]">Badge color</span>
          <Seg
            value={block.badgeColor}
            onChange={(v) => updateBlock(block.id, { badgeColor: v })}
            options={[
              { value: 'accent', label: 'Red' },
              { value: 'ink', label: 'Black' },
            ]}
          />
        </div>
      );
    case 'bullets':
    case 'steps':
    case 'checklist':
      return (
        <div className="flex flex-col gap-1.5">
          <Btn onClick={() => addListItem(block.id, block.items.length - 1)}>+ Add item</Btn>
          <p className="text-[11px] text-[#6D6E71]">Enter adds an item · Backspace on an empty item removes it.</p>
        </div>
      );
    case 'callout':
      return (
        <div className="flex flex-col gap-1.5">
          <Btn
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggleHighlightSelection()}
          >
            Highlight selection
          </Btn>
          <p className="text-[11px] text-[#6D6E71]">
            Select words in the dark bar, then highlight them brand-yellow (or press Ctrl+H).
          </p>
        </div>
      );
    case 'table':
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <Btn onClick={() => tableOp(block.id, 'addRow')}>+ Row</Btn>
          <Btn onClick={() => tableOp(block.id, 'removeRow')}>− Row</Btn>
          <Btn onClick={() => tableOp(block.id, 'addCol')}>+ Column</Btn>
          <Btn onClick={() => tableOp(block.id, 'removeCol')}>− Column</Btn>
        </div>
      );
    case 'signoff':
      return (
        <label className="flex items-center gap-2 text-[12px] text-[#20242B]">
          Signature lines
          <input
            type="number"
            min={1}
            max={20}
            value={block.rows}
            onChange={(e) =>
              updateBlock(block.id, { rows: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
            }
            className="w-16 rounded border border-[#C9CED4] px-2 py-1"
          />
        </label>
      );
    case 'image':
      return (
        <div className="flex flex-col gap-2">
          <label className="text-[12px] text-[#20242B]">
            Width · {block.widthPct}%
            <input
              type="range"
              min={20}
              max={100}
              value={block.widthPct}
              onChange={(e) => updateBlock(block.id, { widthPct: Number(e.target.value) }, `iw:${block.id}`)}
              className="mt-1 w-full accent-[#C8102E]"
            />
          </label>
          {block.src && (
            <Btn onClick={() => updateBlock(block.id, { src: '' })}>Remove image</Btn>
          )}
        </div>
      );
  }
}

export function Editor() {
  const doc = useStore((s) => s.current);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const setDragging = useStore((s) => s.setDragging);
  const insertBlock = useStore((s) => s.insertBlock);
  const moveBlockTo = useStore((s) => s.moveBlockTo);
  const removeBlock = useStore((s) => s.removeBlock);
  const setDocField = useStore((s) => s.setDocField);
  const toLibrary = useStore((s) => s.toLibrary);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saveState = useStore((s) => s.saveState);
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);
  const saveNow = useStore((s) => s.saveNow);
  const contentH = useStore((s) => s.contentH);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);

  const [activeType, setActiveType] = useState<BlockType | null>(null);
  const deskRef = useRef<HTMLDivElement | null>(null);
  const [deskW, setDeskW] = useState(1000);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDeskW(el.clientWidth));
    ro.observe(el);
    setDeskW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const doExport = async () => {
    if (!doc) return;
    setStatus('Exporting PDF…');
    await saveNow();
    const r = await api.exportPdf(doc.id, plainText(doc.title) || 'Policy document');
    if (r.ok && r.path) setStatus(`Saved PDF → ${r.path}`);
    else if (r.canceled) setStatus('PDF export canceled.');
    else if (!r.ok) setStatus(`PDF export failed: ${r.error ?? 'unknown error'}`);
  };

  const doPrint = async () => {
    if (!doc) return;
    setStatus('Opening print dialog…');
    await saveNow();
    const r = await api.printDoc(doc.id);
    if (!r.ok) setStatus(`Print failed: ${r.error ?? 'unknown error'}`);
    else setStatus('Sent to the print dialog.');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const editingText =
        document.activeElement instanceof HTMLElement &&
        (document.activeElement.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void doExport();
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void doPrint();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !editingText) {
        const sel = useStore.getState().selectedId;
        if (sel) {
          e.preventDefault();
          removeBlock(sel);
        }
      } else if (e.key === 'Escape') {
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  if (!doc) return null;

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('new:')) {
      setDragging('palette');
      setActiveType(id.slice(4) as BlockType);
    } else {
      setDragging('block');
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    setActiveType(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith('new:')) {
      const type = activeId.slice(4) as BlockType;
      if (overId.startsWith('slot:')) {
        insertBlock(type, Number(overId.slice(5)));
      } else {
        const idx = doc.blocks.findIndex((b) => b.id === overId);
        insertBlock(type, idx === -1 ? undefined : idx + 1);
      }
    } else if (activeId !== overId && !overId.startsWith('slot:')) {
      moveBlockTo(activeId, overId);
    }
  };

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) ?? null;
  const scale = zoom === 'fit' ? Math.min(1, (deskW - 64) / 816) : zoom;
  const pageH = Math.max(1056, contentH + 2 * 38.4);
  const chipOn = !!doc.chip;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setActiveType(null);
      }}
    >
      <div className="flex h-full flex-col">
        <AppHeader
          left={
            <Btn variant="topbar" onClick={() => void toLibrary()} data-testid="back-to-library">
              <ArrowLeft size={14} /> Library
            </Btn>
          }
          right={
            <>
              <span data-testid="save-state" className="mr-1 text-[11.5px] text-white/60">
                {saveState === 'saved'
                  ? 'All changes saved'
                  : saveState === 'saving'
                    ? 'Saving…'
                    : 'Unsaved changes…'}
              </span>
              <button
                type="button"
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                disabled={!canUndo}
                onClick={undo}
                className="cursor-pointer rounded p-1.5 text-white/85 hover:bg-white/10 disabled:cursor-default disabled:opacity-30"
              >
                <Undo2 size={15} />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!canRedo}
                onClick={redo}
                className="cursor-pointer rounded p-1.5 text-white/85 hover:bg-white/10 disabled:cursor-default disabled:opacity-30"
              >
                <Redo2 size={15} />
              </button>
              <select
                aria-label="Zoom"
                value={String(zoom)}
                onChange={(e) => {
                  const v = e.target.value;
                  setZoom(v === 'fit' ? 'fit' : (Number(v) as Zoom));
                }}
                className="cursor-pointer rounded border border-white/25 bg-transparent px-1.5 py-1 text-[11.5px] text-white/85 [&>option]:text-black"
              >
                <option value="fit">Fit</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
              </select>
              <Btn variant="topbar" onClick={() => void doPrint()} data-testid="print-btn">
                <Printer size={14} /> Print
              </Btn>
              <Btn variant="topbar-primary" onClick={() => void doExport()} data-testid="export-btn">
                <FileDown size={14} /> Export PDF
              </Btn>
            </>
          }
        />

        <div className="flex min-h-0 flex-1">
          <aside className="w-[292px] shrink-0 overflow-y-auto border-r border-[#E1E3E6] bg-white">
            <Panel title="Document">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[11.5px] text-[#6D6E71]">Accent</span>
                <Swatches
                  value={doc.accent}
                  onChange={(c) => setDocField('accent', c)}
                  presets={ACCENT_PRESETS}
                />
              </div>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[11.5px] text-[#6D6E71]">Type size</span>
                <Seg
                  value={doc.audience}
                  onChange={(v) => setDocField('audience', v)}
                  options={[
                    { value: 'employee', label: 'Employee' },
                    { value: 'customer', label: 'Customer' },
                  ]}
                />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[#20242B]">
                <input
                  type="checkbox"
                  checked={chipOn}
                  onChange={(e) =>
                    setDocField('chip', e.target.checked ? { text: 'BRAND', color: '#F39200' } : null)
                  }
                />
                Brand chip (top-right)
              </label>
              {doc.chip && (
                <div className="mt-1.5 flex items-center gap-2 pl-6">
                  <span className="text-[11.5px] text-[#6D6E71]">Chip color</span>
                  <input
                    type="color"
                    aria-label="Chip color"
                    value={doc.chip.color}
                    onChange={(e) => setDocField('chip', { ...doc.chip!, color: e.target.value })}
                    className="h-6 w-9 cursor-pointer rounded border border-[#C9CED4]"
                  />
                </div>
              )}
            </Panel>

            <Panel title="Add blocks">
              <div className="grid grid-cols-2 gap-1.5">
                {PALETTE.map((p) => (
                  <PaletteTile key={p.type} type={p.type} icon={p.icon} />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[#8A9099]">
                Click to add after the selected block — or drag onto the page and snap it anywhere.
              </p>
            </Panel>

            {selectedBlock && (
              <Panel title={`Selected · ${BLOCK_LABELS[selectedBlock.type]}`}>
                <Inspector block={selectedBlock} />
              </Panel>
            )}

            <Panel title="Format">
              <p className="text-[11px] leading-relaxed text-[#6D6E71]">
                Click any text on the page to edit it. Select text and press{' '}
                <b>Ctrl+B</b> for bold, <b>Ctrl+I</b> for italics. Drag the grip on a
                block's left edge to move it — the red line shows where it snaps.
              </p>
            </Panel>
          </aside>

          <main
            ref={deskRef}
            className="min-w-0 flex-1 overflow-auto"
            style={{ background: '#E9E9EC' }}
            onMouseDown={(e) => {
              const t = e.target as HTMLElement;
              if (!t.closest('[data-block]') && !t.closest('[data-panel]')) select(null);
            }}
          >
            <div style={{ width: 816 * scale, height: pageH * scale, margin: '28px auto 64px' }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 816 }}>
                <PageView doc={doc} mode="edit" />
              </div>
            </div>
          </main>
        </div>

        <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[#D8DBDE] bg-white px-3 text-[11.5px] text-[#4A4F57]">
          <span className="truncate pr-4" data-testid="status-text">
            {status}
          </span>
          <FitMeter />
        </footer>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeType && (
          <div
            className="rounded-[6px] border border-[#C8102E] bg-white px-3 py-1.5 text-[12px] font-bold text-[#C8102E] shadow-lg"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            {BLOCK_LABELS[activeType]}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
