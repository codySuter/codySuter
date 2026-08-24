import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Copy, GripVertical, Trash2 } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  effectiveMarginTop,
  INK,
  makeStyles,
  type DocStyles,
} from '../model/docstyle';
import { loadImageScaled } from '../model/image';
import { newBlock } from '../model/blocks';
import { escapeHtml } from '../model/textImport';
import type {
  Block,
  BlockAlign,
  BlockFormat,
  BulletsBlock,
  ChecklistBlock,
  ColumnsBlock,
  ImageBlock,
  StudioDoc,
  SignoffBlock,
  StepsBlock,
  TableBlock,
} from '../model/types';
import {
  COLUMN_CHILD_TYPES,
  FOOTER_FIELDS,
  HEADER_DND_ID,
  MIN_TABLE_COL_PCT,
  PAGE_MARGIN_PX,
  PRINTABLE_H_PX,
} from '../model/types';
import { useStore } from '../store';
import { Editable, type EditableHandle } from './Editable';

export type PageMode = 'edit' | 'print' | 'thumb';

type ListBlock = (BulletsBlock | StepsBlock | ChecklistBlock) & BlockFormat;

function Html({ html, style, className }: { html: string; style?: CSSProperties; className?: string }) {
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Horizontal alignment helpers — text blocks set text-align, flex rows
// (badges, list rows, section heads) shift their justification.
const textAlign = (a?: BlockAlign): CSSProperties =>
  a && a !== 'left' ? { textAlign: a } : {};
const justify = (a?: BlockAlign): CSSProperties =>
  a === 'center' ? { justifyContent: 'center' } : a === 'right' ? { justifyContent: 'flex-end' } : {};

// ---------------------------------------------------------------- lists

function EditableList({
  block,
  doc,
  st,
  readOnly,
}: {
  block: ListBlock;
  doc: StudioDoc;
  st: DocStyles;
  readOnly: boolean;
}) {
  const setListItem = useStore((s) => s.setListItem);
  const addListItem = useStore((s) => s.addListItem);
  const addListItems = useStore((s) => s.addListItems);
  const removeListItem = useStore((s) => s.removeListItem);
  const refs = useRef<(EditableHandle | null)[]>([]);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (pending.current !== null) {
      refs.current[pending.current]?.focus();
      pending.current = null;
    }
  }, [block.items.length]);

  const marker = (i: number): ReactNode => {
    if (block.type === 'bullets') return <span style={st.bulletSquare(doc.accent)} />;
    if (block.type === 'steps') return <span style={st.stepNumber(doc.accent)}>{i + 1}.</span>;
    return <span style={st.checkBox} />;
  };
  const aligned = !!block.align && block.align !== 'left';
  const rowStyle: CSSProperties = {
    ...(block.type === 'bullets' ? st.bulletRow : block.type === 'steps' ? st.stepRow : st.checkRow),
    ...justify(block.align),
  };
  const textStyle: CSSProperties = {
    ...st.bodyText,
    ...(aligned ? { flex: '0 1 auto' } : { flex: 1 }),
    minWidth: 0,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {block.items.map((html, i) => (
        <div key={i} style={rowStyle}>
          {marker(i)}
          {readOnly ? (
            <Html html={html} style={textStyle} />
          ) : (
            <Editable
              ref={(el) => {
                refs.current[i] = el;
              }}
              html={html}
              style={textStyle}
              placeholder="List item — Enter adds another"
              onCommit={(h) => setListItem(block.id, i, h, `li:${block.id}:${i}`)}
              onEnter={() => {
                pending.current = i + 1;
                addListItem(block.id, i);
              }}
              onEmptyBackspace={() => {
                if (block.items.length > 1) {
                  pending.current = Math.max(0, i - 1);
                  removeListItem(block.id, i);
                }
              }}
              onPasteLines={(lines) => {
                pending.current = i + lines.length;
                addListItems(block.id, i, lines.map(escapeHtml));
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- table

function TableView({
  block,
  st,
  readOnly,
}: {
  block: TableBlock;
  st: DocStyles;
  readOnly: boolean;
}) {
  const setCell = useStore((s) => s.setCell);
  const setFocusedCell = useStore((s) => s.setFocusedCell);
  const selected = useStore((s) => s.selectedId === block.id);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const n = block.header.length;
  const hasCustomWidths = !!block.widths && block.widths.length === n;
  const widths = hasCustomWidths ? block.widths! : Array.from({ length: n }, () => 100 / n);
  const alignOf = (c: number): CSSProperties => textAlign(block.aligns?.[c]);

  // Drag a column boundary to resize the two columns it separates.
  const startDivider = (j: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wrapW = wrapRef.current?.clientWidth || 1;
    const startX = e.clientX;
    const w0 = [...widths];
    const move = (ev: PointerEvent) => {
      const dpct = ((ev.clientX - startX) / wrapW) * 100;
      const pair = w0[j] + w0[j + 1];
      const wi = Math.max(MIN_TABLE_COL_PCT, Math.min(w0[j] + dpct, pair - MIN_TABLE_COL_PCT));
      const next = [...w0];
      next[j] = wi;
      next[j + 1] = pair - wi;
      useStore.getState().tableSetWidths(block.id, next, `tw:${block.id}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().breakHistory();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  let cum = 0;
  const boundaries = widths.slice(0, -1).map((w) => (cum += w));

  return (
    <div ref={wrapRef} style={{ ...st.tableWrap, position: 'relative' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: hasCustomWidths ? 'fixed' : undefined,
        }}
      >
        {hasCustomWidths && (
          <colgroup>
            {widths.map((w, c) => (
              <col key={c} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {block.header.map((h, c) => (
              <th key={c} style={{ ...st.th, ...alignOf(c) }}>
                {readOnly ? (
                  <Html html={h} />
                ) : (
                  <Editable
                    html={h}
                    singleLine
                    placeholder="Column"
                    onCommit={(v) => setCell(block.id, -1, c, v, `th:${block.id}:${c}`)}
                    onFocus={() => setFocusedCell({ blockId: block.id, row: -1, col: c })}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ ...st.td, ...alignOf(c) }}>
                  {readOnly ? (
                    <Html html={cell} />
                  ) : (
                    <Editable
                      html={cell}
                      placeholder="—"
                      onCommit={(v) => setCell(block.id, r, c, v, `td:${block.id}:${r}:${c}`)}
                      onFocus={() => setFocusedCell({ blockId: block.id, row: r, col: c })}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly &&
        selected &&
        boundaries.map((pct, j) => (
          <div
            key={j}
            role="separator"
            aria-label={`Resize column ${j + 1}`}
            title="Drag to resize columns"
            onPointerDown={startDivider(j)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${pct}%`,
              width: 9,
              transform: 'translateX(-50%)',
              cursor: 'col-resize',
              zIndex: 20,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '50%',
                width: 2,
                marginLeft: -1,
                background: 'rgba(200, 16, 46, 0.35)',
              }}
            />
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------- signoff

// Agreement block, styled exactly like the Radio & Scanner Policy
// Contract: heavy top rule, heading, acknowledgment paragraph, then
// sign-above-the-line rows with the small uppercase label under each
// line and a fixed-width Date column.
function SignoffView({
  block,
  st,
  readOnly,
}: {
  block: SignoffBlock;
  st: DocStyles;
  readOnly: boolean;
}) {
  const updateBlock = useStore((s) => s.updateBlock);
  const setSignLineLabel = useStore((s) => s.setSignLineLabel);
  const removeSignLine = useStore((s) => s.removeSignLine);
  return (
    <div style={st.signBlock}>
      {readOnly ? (
        <Html html={block.heading} style={st.signHeading} />
      ) : (
        <Editable
          html={block.heading}
          singleLine
          style={st.signHeading}
          placeholder="Employee Acknowledgment & Agreement"
          onCommit={(h) => updateBlock(block.id, { heading: h }, `so:${block.id}`)}
        />
      )}
      {readOnly ? (
        block.body ? (
          <Html html={block.body} style={st.signBody} />
        ) : null
      ) : (
        <Editable
          html={block.body}
          style={st.signBody}
          placeholder="By signing below, I acknowledge that I have read and understand the policy above…"
          onCommit={(h) => updateBlock(block.id, { body: h }, `sb:${block.id}`)}
        />
      )}
      {block.lines.map((line, i) => (
        <div key={i} style={st.signGrid}>
          <div style={st.signLine}>
            {readOnly ? (
              <Html html={line.label} />
            ) : (
              <Editable
                html={line.label}
                singleLine
                placeholder="Line label"
                onCommit={(h) => setSignLineLabel(block.id, i, h, `sl:${block.id}:${i}`)}
                onEmptyBackspace={() => removeSignLine(block.id, i)}
              />
            )}
          </div>
          {line.withDate ? <div style={st.signLine}>Date</div> : <div />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- columns

function NestedBlock({ block, children }: { block: Block; children: ReactNode }) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const removeBlock = useStore((s) => s.removeBlock);
  const duplicateBlock = useStore((s) => s.duplicateBlock);
  const moveBlockBy = useStore((s) => s.moveBlockBy);
  const sel = selectedId === block.id;
  return (
    <div
      data-block={block.id}
      data-testid="nested-block"
      className={`aps-block${sel ? ' sel' : ''}`}
      style={{ position: 'relative' }}
      onMouseDownCapture={(e) => {
        e.stopPropagation();
        select(block.id);
      }}
    >
      {sel && (
        <div className="aps-toolbar aps-chrome">
          <button type="button" aria-label="Move up" title="Move up" onClick={() => moveBlockBy(block.id, -1)}>
            <ArrowUp size={13} />
          </button>
          <button type="button" aria-label="Move down" title="Move down" onClick={() => moveBlockBy(block.id, 1)}>
            <ArrowDown size={13} />
          </button>
          <button type="button" aria-label="Duplicate block" title="Duplicate" onClick={() => duplicateBlock(block.id)}>
            <Copy size={13} />
          </button>
          <button
            type="button"
            aria-label="Delete block"
            title="Delete"
            className="danger"
            onClick={() => removeBlock(block.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

const COLUMN_ADD_LABELS: Record<(typeof COLUMN_CHILD_TYPES)[number], string> = {
  paragraph: '+ Text',
  bullets: '+ Bullets',
  steps: '+ Steps',
  checklist: '+ Checklist',
};

function ColumnsView({
  block,
  doc,
  st,
  readOnly,
}: {
  block: ColumnsBlock;
  doc: StudioDoc;
  st: DocStyles;
  readOnly: boolean;
}) {
  const setColumnHeading = useStore((s) => s.setColumnHeading);
  const addColumnChild = useStore((s) => s.addColumnChild);

  const renderSide = (side: 'left' | 'right') => {
    const col = block[side];
    const grow = side === 'left' ? block.ratio : 100 - block.ratio;
    return (
      <div style={{ flex: `${grow} 1 0%`, minWidth: 0 }}>
        {readOnly ? (
          col.heading ? (
            <Html html={col.heading} style={st.colHeading} />
          ) : null
        ) : (
          <Editable
            html={col.heading}
            singleLine
            style={st.colHeading}
            placeholder="Column heading (optional)"
            onCommit={(h) => setColumnHeading(block.id, side, h, `colh:${block.id}:${side}`)}
          />
        )}
        {col.blocks.map((child, i) => {
          const content = (
            <BlockContent block={child} doc={doc} st={st} number={0} readOnly={readOnly} />
          );
          return (
            <div key={child.id} style={{ marginTop: Math.max(0, (i === 0 ? 0 : 6) + (child.spaceBefore || 0)) }}>
              {readOnly ? content : <NestedBlock block={child}>{content}</NestedBlock>}
            </div>
          );
        })}
        {!readOnly && (
          <div className="aps-chrome" style={{ display: 'flex', gap: 4, marginTop: 7, flexWrap: 'wrap' }}>
            {COLUMN_CHILD_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`col-add-${side}-${t}`}
                title={`Add ${t} to this column`}
                onClick={() => addColumnChild(block.id, side, t)}
                style={{
                  fontFamily: "'Barlow Semi Condensed', sans-serif",
                  fontWeight: 700,
                  fontSize: 10.5,
                  letterSpacing: '0.03em',
                  border: '1px dashed #C4C9CE',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#6D6E71',
                  padding: '2px 7px',
                  cursor: 'pointer',
                }}
              >
                {COLUMN_ADD_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 18 }}>
      {renderSide('left')}
      {renderSide('right')}
    </div>
  );
}

// ---------------------------------------------------------------- image

function ImageView({
  block,
  st,
  readOnly,
}: {
  block: ImageBlock & BlockFormat;
  st: DocStyles;
  readOnly: boolean;
}) {
  const updateBlock = useStore((s) => s.updateBlock);
  const setStatus = useStore((s) => s.setStatus);
  const selected = useStore((s) => s.selectedId === block.id);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const src = await loadImageScaled(file);
      updateBlock(block.id, { src });
    } catch {
      setStatus('Couldn’t read that image — try a PNG or JPG.');
    }
  };

  const margin =
    block.align === 'left' ? '0 auto 0 0' : block.align === 'right' ? '0 0 0 auto' : '0 auto';
  // An uncaptioned image takes no caption space; the caption line only
  // appears while the block is selected (or once a caption exists).
  const showCaptionEditor = !readOnly && (selected || block.caption !== '');

  return (
    <div>
      {block.src ? (
        <img
          src={block.src}
          alt=""
          style={{
            display: 'block',
            margin,
            width: `${block.widthPct}%`,
            maxWidth: '100%',
            borderRadius: 4,
          }}
        />
      ) : readOnly ? null : (
        <div
          style={{
            border: '1.5px dashed #C4C9CE',
            borderRadius: 6,
            padding: '26px 12px',
            textAlign: 'center',
            color: '#8A9099',
            fontSize: 12,
          }}
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              fontFamily: "'Barlow Semi Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              background: '#fff',
              border: `1.5px solid ${INK}`,
              borderRadius: 5,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Choose an image…
          </button>
          <div style={{ marginTop: 6 }}>PNG or JPG — or drag a file onto the page, or paste one.</div>
        </div>
      )}
      {!readOnly && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      )}
      {readOnly ? (
        block.caption ? (
          <Html html={block.caption} style={{ ...st.imageCaption, ...textAlign(block.align) }} />
        ) : null
      ) : showCaptionEditor ? (
        <Editable
          html={block.caption}
          singleLine
          style={{ ...st.imageCaption, ...textAlign(block.align) }}
          placeholder="Add a caption (optional)"
          onCommit={(h) => updateBlock(block.id, { caption: h }, `cap:${block.id}`)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- blocks

function BlockContent({
  block,
  doc,
  st,
  number,
  readOnly,
}: {
  block: Block;
  doc: StudioDoc;
  st: DocStyles;
  number: number;
  readOnly: boolean;
}) {
  const updateBlock = useStore((s) => s.updateBlock);
  const insertBlocksAfter = useStore((s) => s.insertBlocksAfter);

  switch (block.type) {
    case 'section':
    case 'header': {
      const aligned = !!block.align && block.align !== 'left';
      const titleStyle: CSSProperties = {
        ...st.sectionTitle,
        ...(aligned ? { flex: '0 1 auto', ...textAlign(block.align) } : {}),
      };
      return (
        <div style={{ ...st.sectionHead, ...justify(block.align) }}>
          {block.type === 'section' && <span style={st.sectionNumber}>{number}</span>}
          {readOnly ? (
            <Html html={block.title} style={titleStyle} />
          ) : (
            <Editable
              html={block.title}
              singleLine
              style={titleStyle}
              placeholder={block.type === 'section' ? 'Section title' : 'Header'}
              onCommit={(h) => updateBlock(block.id, { title: h }, `sec:${block.id}`)}
            />
          )}
        </div>
      );
    }
    case 'paragraph': {
      const style = { ...(block.muted ? st.mutedText : st.bodyText), ...textAlign(block.align) };
      const cls = block.muted ? 'aps-muted' : undefined;
      return readOnly ? (
        <Html html={block.html} style={style} className={cls} />
      ) : (
        <Editable
          html={block.html}
          style={style}
          className={cls}
          placeholder="Write a paragraph…"
          onCommit={(h) => updateBlock(block.id, { html: h }, `p:${block.id}`)}
          onPasteLines={(lines) =>
            insertBlocksAfter(
              block.id,
              lines.map((line) => {
                const p = newBlock('paragraph');
                if (p.type === 'paragraph') {
                  p.html = escapeHtml(line);
                  p.muted = block.muted;
                  if (block.align) p.align = block.align;
                }
                return p;
              }),
            )
          }
        />
      );
    }
    case 'badgeRow': {
      const bg = block.badgeColor === 'ink' ? INK : doc.accent;
      const aligned = !!block.align && block.align !== 'left';
      const textStyle: CSSProperties = {
        ...st.bodyText,
        ...(aligned ? { flex: '0 1 auto' } : { flex: 1 }),
        minWidth: 0,
      };
      return (
        <div style={{ ...st.badgeRow, ...justify(block.align) }}>
          {readOnly ? (
            <Html html={block.badge} style={st.badge(bg)} />
          ) : (
            <Editable
              html={block.badge}
              singleLine
              style={st.badge(bg)}
              placeholder="LABEL"
              onCommit={(h) => updateBlock(block.id, { badge: h }, `bg:${block.id}`)}
            />
          )}
          {readOnly ? (
            <Html html={block.html} style={textStyle} />
          ) : (
            <Editable
              html={block.html}
              style={textStyle}
              placeholder="What the badge means…"
              onCommit={(h) => updateBlock(block.id, { html: h }, `bt:${block.id}`)}
            />
          )}
        </div>
      );
    }
    case 'bullets':
    case 'steps':
    case 'checklist':
      return <EditableList block={block} doc={doc} st={st} readOnly={readOnly} />;
    case 'callout':
      return (
        <div style={st.calloutBox}>
          <div style={{ ...st.calloutHead, ...textAlign(block.align) }}>
            {readOnly ? (
              <Html html={block.heading} />
            ) : (
              <Editable
                html={block.heading}
                singleLine
                allowHighlight
                placeholder="The rule in one line"
                onCommit={(h) => updateBlock(block.id, { heading: h }, `ch:${block.id}`)}
              />
            )}
          </div>
          <div style={{ ...st.calloutBody, ...textAlign(block.align) }}>
            {readOnly ? (
              <Html html={block.body} />
            ) : (
              <Editable
                html={block.body}
                placeholder="Why it matters, in a sentence or two."
                onCommit={(h) => updateBlock(block.id, { body: h }, `cb:${block.id}`)}
              />
            )}
          </div>
        </div>
      );
    case 'table':
      return <TableView block={block} st={st} readOnly={readOnly} />;
    case 'signoff':
      return <SignoffView block={block} st={st} readOnly={readOnly} />;
    case 'image':
      return <ImageView block={block} st={st} readOnly={readOnly} />;
    case 'columns':
      return <ColumnsView block={block} doc={doc} st={st} readOnly={readOnly} />;
    case 'pageBreak':
      // Prints as an invisible break; shows as a labeled divider in the
      // editor. data-pagebreak lets PNG export find the page boundaries.
      return readOnly ? (
        <div data-pagebreak style={{ breakAfter: 'page', height: 0 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#8A9099' }}>
          <div style={{ flex: 1, borderTop: '2px dashed #C4C9CE' }} />
          <span
            style={{
              fontFamily: "'Barlow Semi Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '0.08em',
              border: '1px dashed #C4C9CE',
              borderRadius: 4,
              padding: '2px 8px',
            }}
          >
            PAGE BREAK
          </span>
          <div style={{ flex: 1, borderTop: '2px dashed #C4C9CE' }} />
        </div>
      );
  }
}

// ---------------------------------------------------------------- footer

function FooterArea({
  doc,
  st,
  readOnly,
}: {
  doc: StudioDoc;
  st: DocStyles;
  readOnly: boolean;
}) {
  const setDocField = useStore((s) => s.setDocField);
  if (!doc.footer?.show) return null;
  const filled = FOOTER_FIELDS.filter(([key]) => doc.footer[key].trim() !== '');
  if (readOnly && filled.length === 0) return null;
  const fields = readOnly ? filled : FOOTER_FIELDS;
  return (
    <div className="aps-keep" data-testid="doc-footer" style={{ ...st.footerWrap, marginTop: 16 }}>
      {fields.map(([key, label]) => (
        <div key={key} style={st.footerItem}>
          <div style={st.footerLabel}>{label}</div>
          {readOnly ? (
            <Html html={doc.footer[key]} style={st.footerValue} />
          ) : (
            <Editable
              html={doc.footer[key]}
              singleLine
              style={st.footerValue}
              placeholder={key === 'effective' ? 'MM/DD/YYYY' : '—'}
              onCommit={(h) =>
                setDocField(
                  'footer',
                  { ...(useStore.getState().current?.footer ?? doc.footer), [key]: h },
                  `ft:${key}`,
                )
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------- edit-mode chrome

function DropSlot({ id, tall }: { id: string; tall?: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        height: tall ? 34 : 14,
        margin: tall ? '4px 0 0' : '-7px 0',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 3,
          marginTop: -1.5,
          borderRadius: 2,
          background: '#C8102E',
          opacity: isOver ? 1 : 0.18,
          transition: 'opacity 120ms',
        }}
      />
    </div>
  );
}

function SortableBlock({
  block,
  marginTop,
  children,
}: {
  block: Block;
  marginTop: number;
  children: ReactNode;
}) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const removeBlock = useStore((s) => s.removeBlock);
  const duplicateBlock = useStore((s) => s.duplicateBlock);
  const moveBlockBy = useStore((s) => s.moveBlockBy);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const sel = selectedId === block.id;

  return (
    <div
      ref={setNodeRef}
      data-block={block.id}
      data-testid="block"
      className={`aps-block${sel ? ' sel' : ''}`}
      style={{
        marginTop,
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 40 : undefined,
      }}
      onMouseDownCapture={() => select(block.id)}
    >
      <button
        type="button"
        className="aps-chrome aps-handle"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>
      {sel && (
        <div className="aps-toolbar aps-chrome">
          <button type="button" aria-label="Move up" title="Move up" onClick={() => moveBlockBy(block.id, -1)}>
            <ArrowUp size={13} />
          </button>
          <button type="button" aria-label="Move down" title="Move down" onClick={() => moveBlockBy(block.id, 1)}>
            <ArrowDown size={13} />
          </button>
          <button type="button" aria-label="Duplicate block" title="Duplicate" onClick={() => duplicateBlock(block.id)}>
            <Copy size={13} />
          </button>
          <button
            type="button"
            aria-label="Delete block"
            title="Delete"
            className="danger"
            onClick={() => removeBlock(block.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- header

// The title section (kicker, title, subtitle, chip). The accent bar stays
// fixed at the very top of the page; this part is draggable in the editor
// so blocks — a banner image, a notice — can sit above the title.
function HeaderArea({
  doc,
  st,
  readOnly,
}: {
  doc: StudioDoc;
  st: DocStyles;
  readOnly: boolean;
}) {
  const setDocField = useStore((s) => s.setDocField);
  return (
    <div style={st.headerRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {readOnly ? (
          <Html html={doc.kicker} style={st.kicker} />
        ) : (
          <Editable
            html={doc.kicker}
            singleLine
            style={st.kicker}
            placeholder="Kicker line"
            onCommit={(h) => setDocField('kicker', h, 'doc:kicker')}
          />
        )}
        {readOnly ? (
          <Html html={doc.title} style={st.title} />
        ) : (
          <Editable
            html={doc.title}
            singleLine
            style={st.title}
            placeholder="Document title"
            onCommit={(h) => setDocField('title', h, 'doc:title')}
          />
        )}
        {readOnly ? (
          <Html html={doc.subtitle} style={st.subtitle} />
        ) : (
          <Editable
            html={doc.subtitle}
            singleLine
            style={st.subtitle}
            placeholder="Subtitle — what this document covers"
            onCommit={(h) => setDocField('subtitle', h, 'doc:subtitle')}
          />
        )}
      </div>
      {doc.chip && (
        <div style={st.chip(doc.chip.color)}>
          {readOnly ? (
            <Html html={doc.chip.text} />
          ) : (
            <Editable
              html={doc.chip.text}
              singleLine
              placeholder="CHIP"
              onCommit={(h) => setDocField('chip', { ...doc.chip!, text: h }, 'doc:chip')}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SortableHeader({ children }: { children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: HEADER_DND_ID });
  return (
    <div
      ref={setNodeRef}
      data-testid="doc-header-item"
      className="aps-block"
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 40 : undefined,
      }}
    >
      <button
        type="button"
        className="aps-chrome aps-handle"
        aria-label="Drag the title section"
        title="Drag the title section — blocks can sit above it"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- page

export function PageView({ doc, mode }: { doc: StudioDoc; mode: PageMode }) {
  const st = makeStyles(doc.accent, doc.typeScale ?? 100);
  const readOnly = mode !== 'edit';
  const dragging = useStore((s) => s.dragging);
  const contentH = useStore((s) => s.contentH);
  const setContentH = useStore((s) => s.setContentH);
  const insertBlock = useStore((s) => s.insertBlock);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode !== 'edit') return;
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentH(el.offsetHeight));
    ro.observe(el);
    setContentH(el.offsetHeight);
    return () => ro.disconnect();
  }, [mode, setContentH]);

  let n = 0;
  const numbers = doc.blocks.map((b) => (b.type === 'section' ? ++n : 0));
  // Manual breaks change where real pages start, so the automatic
  // overflow lines would mislead — the fit meter explains instead.
  const manualBreaks = doc.blocks.some((b) => b.type === 'pageBreak');

  const h = Math.max(0, Math.min(doc.headerAt ?? 0, doc.blocks.length));
  const above = doc.blocks.slice(0, h);
  const below = doc.blocks.slice(h);

  const pageStyle: CSSProperties =
    mode === 'print'
      ? { ...st.page, width: '7.7in', padding: 0 }
      : {
          ...st.page,
          width: 816,
          minHeight: 1056,
          padding: PAGE_MARGIN_PX,
          position: 'relative',
          ...(mode === 'edit'
            ? { boxShadow: '0 3px 16px rgba(21, 24, 29, 0.18)', borderRadius: 6 }
            : { height: 1056, overflow: 'hidden' }),
        };

  const extraPages = Math.max(0, Math.ceil(contentH / PRINTABLE_H_PX) - 1);

  const readOnlyRun = (blocks: Block[], offset: number) =>
    blocks.map((block, i) => (
      <div
        key={block.id}
        className="aps-keep"
        style={{
          marginTop: effectiveMarginTop(i === 0 ? null : blocks[i - 1].type, block.type, block.spaceBefore),
        }}
      >
        <BlockContent block={block} doc={doc} st={st} number={numbers[offset + i]} readOnly />
      </div>
    ));

  const editableRun = (blocks: Block[], offset: number, aboveHeader: boolean) =>
    blocks.map((block, i) => (
      <div key={block.id}>
        {dragging === 'palette' && <DropSlot id={`slot:${offset + i}:${aboveHeader ? 1 : 0}`} />}
        <SortableBlock
          block={block}
          marginTop={effectiveMarginTop(i === 0 ? null : blocks[i - 1].type, block.type, block.spaceBefore)}
        >
          <BlockContent block={block} doc={doc} st={st} number={numbers[offset + i]} readOnly={false} />
        </SortableBlock>
      </div>
    ));

  return (
    <div className="aps-doc" style={pageStyle} data-testid={`page-${mode}`}>
      <div ref={mode === 'edit' ? contentRef : undefined}>
        <div style={st.accentBar} />
        {readOnly ? (
          <>
            {readOnlyRun(above, 0)}
            <HeaderArea doc={doc} st={st} readOnly />
            {readOnlyRun(below, h)}
          </>
        ) : (
          <SortableContext
            items={[...above.map((b) => b.id), HEADER_DND_ID, ...below.map((b) => b.id)]}
            strategy={verticalListSortingStrategy}
          >
            {editableRun(above, 0, true)}
            {dragging === 'palette' && <DropSlot id={`slot:${h}:1`} />}
            <SortableHeader>
              <HeaderArea doc={doc} st={st} readOnly={false} />
            </SortableHeader>
            {editableRun(below, h, false)}
            {dragging === 'palette' && <DropSlot id={`slot:${doc.blocks.length}:0`} tall />}
            {doc.blocks.length === 0 && (
              <button
                type="button"
                onClick={() => insertBlock('section')}
                style={{
                  width: '100%',
                  marginTop: 16,
                  border: '1.5px dashed #C4C9CE',
                  borderRadius: 6,
                  background: 'transparent',
                  padding: '30px 12px',
                  color: '#8A9099',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Drag a block here from the left panel — or click to add your first section.
              </button>
            )}
          </SortableContext>
        )}
        <FooterArea doc={doc} st={st} readOnly={readOnly} />
      </div>

      {mode === 'edit' &&
        !manualBreaks &&
        Array.from({ length: extraPages }).map((_, i) => {
          const top = PAGE_MARGIN_PX + (i + 1) * PRINTABLE_H_PX;
          return (
            <div
              key={i}
              style={{ position: 'absolute', left: 0, right: 0, top, height: 0, pointerEvents: 'none', zIndex: 30 }}
            >
              <div style={{ borderTop: '2px dashed rgba(200, 16, 46, 0.55)', position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: -9,
                    background: '#C8102E',
                    color: '#fff',
                    fontFamily: "'Barlow Semi Condensed', sans-serif",
                    fontWeight: 700,
                    fontSize: 9,
                    letterSpacing: '0.08em',
                    padding: '2px 7px',
                    borderRadius: 3,
                  }}
                >
                  PAGE {i + 2} STARTS
                </span>
              </div>
            </div>
          );
        })}
    </div>
  );
}
