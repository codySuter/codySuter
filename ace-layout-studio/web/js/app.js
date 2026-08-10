'use strict';
/* Ace Layout Studio — top-down store shelving blueprint editor.
   All world coordinates are inches. view.scale is screen px per inch. */

/* ============================== utils ============================== */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 42 -> 3' 6" */
function fmtLen(v) {
  v = Math.round(v);
  const neg = v < 0 ? '-' : '';
  v = Math.abs(v);
  const ft = Math.floor(v / 12), inch = v % 12;
  if (!ft) return `${neg}${inch}"`;
  if (!inch) return `${neg}${ft}'`;
  return `${neg}${ft}' ${inch}"`;
}

/* Accepts: 42 · 42" · 42in · 3' · 3ft · 3'6 · 3' 6" · 3ft 6in · 3-6. Returns inches or null. */
function parseLen(str) {
  if (str == null) return null;
  str = String(str).trim().toLowerCase().replace(/[””]/g, '"').replace(/[’']/g, "'");
  if (!str) return null;
  let m = str.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|f)\s*[- ]?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0) * (m[1].startsWith('-') ? -1 : 1));
  m = str.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in)?$/);
  if (m) return Math.round(parseFloat(m[1]));
  m = str.match(/^(-?\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(parseInt(m[1], 10) * 12 + parseFloat(m[2]) * (m[1].startsWith('-') ? -1 : 1));
  return null;
}

/* ============================== fixture types ============================== */

const TYPES = {
  shelf:  { name: 'Shelving',      fill: '#f2f3f4', stroke: '#6D6E71' },
  endcap: { name: 'Endcap',        fill: '#d7d9db', stroke: '#6D6E71' },
  wall:   { name: 'Wall',          fill: '#6D6E71', stroke: '#4c4d50' },
  block:  { name: 'Fixture block', fill: '#ffffff', stroke: '#9a9ca0' },
};

const PALETTE = [
  { type: 'shelf',  w: 48, d: 24, label: "4' Shelving",   desc: '48" wide' },
  { type: 'shelf',  w: 36, d: 24, label: "3' Shelving",   desc: '36" wide' },
  { type: 'endcap', w: 36, d: 18, label: "3' Endcap",     desc: '36" wide' },
  { type: 'wall',   w: 96, d: 6,  label: 'Wall',          desc: '8\' run, 6" thick' },
  { type: 'block',  w: 48, d: 48, label: 'Fixture block', desc: 'checkout, pallet…' },
];

/* ============================== state ============================== */

const LS_KEY = 'ace-layout-studio:v1';

let db = null;          // { layouts:[{id,name,units,updated}], currentId }
let layout = null;      // current layout object (reference into db.layouts)
let view = { x: -40, y: -40, scale: 1.4 };
let sel = new Set();    // selected unit ids
let undoStack = [], redoStack = [];
let placing = null;     // { tpl, at:{x,y}|null, sticky:bool }
let drag = null;        // active unit-drag / marquee / pan / pinch state
let tool = 'select';    // select | pan | label | duplicate | extend | erase
let spaceHeld = false;
let guides = [];        // snap guide segments to draw
let saveTimer = null;

function newLayout(name) {
  return { id: uid(), name: name || 'New layout', units: [], updated: Date.now() };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.layouts) && parsed.layouts.length) return parsed;
    }
  } catch (e) { /* corrupted storage — start fresh */ }
  const l = newLayout('Store floor');
  return { layouts: [l], currentId: l.id };
}

function persist() {
  layout.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}

function flushSave() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) { /* quota */ }
}

window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});

function pushUndo() {
  undoStack.push(JSON.stringify(layout.units));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(layout.units));
  layout.units = JSON.parse(undoStack.pop());
  afterHistoryJump();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(layout.units));
  layout.units = JSON.parse(redoStack.pop());
  afterHistoryJump();
}

function afterHistoryJump() {
  const ids = new Set(layout.units.map(u => u.id));
  sel = new Set([...sel].filter(id => ids.has(id)));
  persist(); renderAll(); updateUndoButtons();
}

function updateUndoButtons() {
  $('btnUndo').disabled = !undoStack.length;
  $('btnRedo').disabled = !redoStack.length;
}

/* ============================== geometry ============================== */

/* Axis-aligned footprint. rot 90/270 swaps width/depth. */
function aabb(u) {
  const vert = u.rot % 180 !== 0;
  return { x: u.x, y: u.y, w: vert ? u.d : u.w, h: vert ? u.w : u.d };
}

function unitById(id) { return layout.units.find(u => u.id === id); }
function selectedUnits() { return layout.units.filter(u => sel.has(u.id)); }

function selectionBBox(units) {
  if (!units.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const u of units) {
    const b = aabb(u);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function contentBBox() { return selectionBBox(layout.units); }

/* screen px -> world inches (px relative to canvas element) */
function toWorld(px, py) { return { x: view.x + px / view.scale, y: view.y + py / view.scale }; }
function canvasPoint(e) {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/* ============================== snapping ============================== */

/* Snap a moving box against grid + other units' edges/centers.
   Returns {x, y, guides:[{axis,at,from,to}]}. */
function snapBox(box, others, opts = {}) {
  let x = Math.round(box.x), y = Math.round(box.y);
  const out = { x, y, guides: [] };
  if (opts.noEdges) { return out; }
  const th = Math.max(1, 9 / view.scale); // snap threshold in inches

  let bestX = null, bestY = null;
  for (const o of others) {
    const ob = aabb(o);
    const xTargets = [ob.x, ob.x + ob.w, ob.x + ob.w / 2];
    const yTargets = [ob.y, ob.y + ob.h, ob.y + ob.h / 2];
    const xEdges = [x, x + box.w, x + box.w / 2];
    const yEdges = [y, y + box.h, y + box.h / 2];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if ((i === 2) !== (j === 2)) continue; // centers only snap to centers
        const dx = xTargets[j] - xEdges[i];
        if (Math.abs(dx) <= th && (bestX === null || Math.abs(dx) < Math.abs(bestX.d)))
          bestX = { d: dx, at: xTargets[j], ob };
        const dy = yTargets[j] - yEdges[i];
        if (Math.abs(dy) <= th && (bestY === null || Math.abs(dy) < Math.abs(bestY.d)))
          bestY = { d: dy, at: yTargets[j], ob };
      }
    }
  }
  if (bestX) {
    out.x = Math.round(x + bestX.d);
    const y1 = Math.min(y, bestX.ob.y), y2 = Math.max(y + box.h, bestX.ob.y + bestX.ob.h);
    out.guides.push({ axis: 'v', at: bestX.at, from: y1 - 12, to: y2 + 12 });
  }
  if (bestY) {
    out.y = Math.round(y + bestY.d);
    const x1 = Math.min(x, bestY.ob.x), x2 = Math.max(x + box.w, bestY.ob.x + bestY.ob.w);
    out.guides.push({ axis: 'h', at: bestY.at, from: x1 - 12, to: x2 + 12 });
  }
  return out;
}

/* Nearest neighbor gap on each side of box (only where projections overlap). */
function neighborGaps(box, others) {
  const res = {};
  for (const o of others) {
    const ob = aabb(o);
    const yOv = Math.min(box.y + box.h, ob.y + ob.h) - Math.max(box.y, ob.y);
    const xOv = Math.min(box.x + box.w, ob.x + ob.w) - Math.max(box.x, ob.x);
    if (yOv > 0.5) {
      const mid = (Math.max(box.y, ob.y) + Math.min(box.y + box.h, ob.y + ob.h)) / 2;
      if (ob.x + ob.w <= box.x + 0.01) {
        const gap = box.x - (ob.x + ob.w);
        if (!res.left || gap < res.left.gap) res.left = { gap, at: mid, edge: ob.x + ob.w };
      } else if (ob.x >= box.x + box.w - 0.01) {
        const gap = ob.x - (box.x + box.w);
        if (!res.right || gap < res.right.gap) res.right = { gap, at: mid, edge: ob.x };
      }
    }
    if (xOv > 0.5) {
      const mid = (Math.max(box.x, ob.x) + Math.min(box.x + box.w, ob.x + ob.w)) / 2;
      if (ob.y + ob.h <= box.y + 0.01) {
        const gap = box.y - (ob.y + ob.h);
        if (!res.up || gap < res.up.gap) res.up = { gap, at: mid, edge: ob.y + ob.h };
      } else if (ob.y >= box.y + box.h - 0.01) {
        const gap = ob.y - (box.y + box.h);
        if (!res.down || gap < res.down.gap) res.down = { gap, at: mid, edge: ob.y };
      }
    }
  }
  return res;
}

/* ============================== rendering ============================== */

const svg = $('canvas');
const gWorld = $('world'), gUnits = $('units'), gOverlay = $('overlay'),
      gGhost = $('ghost'), gScreen = $('screenOverlay');

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

function renderAll() {
  gWorld.setAttribute('transform',
    `scale(${view.scale}) translate(${-view.x} ${-view.y})`);
  renderGrid();
  renderUnits();
  renderOverlay();
  renderGhost();
  renderInspector();
  renderStatus();
}

function renderGrid() {
  const r = svg.getBoundingClientRect();
  const x1 = view.x - 60, y1 = view.y - 60;
  const w = r.width / view.scale + 120, h = r.height / view.scale + 120;
  for (const [id, minScale] of [['gridRectMinor', 0.55], ['gridRectMajor', 0.12]]) {
    const el = $(id);
    el.setAttribute('x', x1); el.setAttribute('y', y1);
    el.setAttribute('width', w); el.setAttribute('height', h);
    el.style.display = view.scale >= minScale ? '' : 'none';
  }
}

function unitMarkup(u, opts = {}) {
  const t = TYPES[u.type] || TYPES.block;
  const b = aabb(u);
  const selected = !opts.forExport && sel.has(u.id);
  let s = `<g data-uid="${u.id}">`;
  s += `<rect class="u-rect" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"
        fill="${t.fill}" stroke="${t.stroke}"/>`;

  // double-sided gondola divider down the long axis
  if (u.type === 'shelf' && u.d >= 30) {
    if (u.rot % 180 === 0)
      s += `<line class="u-divider" x1="${b.x}" y1="${b.y + b.h / 2}" x2="${b.x + b.w}" y2="${b.y + b.h / 2}"/>`;
    else
      s += `<line class="u-divider" x1="${b.x + b.w / 2}" y1="${b.y}" x2="${b.x + b.w / 2}" y2="${b.y + b.h}"/>`;
  }

  // location code label, rotated with the unit, kept upright
  if (u.code) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const along = u.rot % 180 === 0 ? b.w : b.h;   // room along the unit's width axis
    const across = u.rot % 180 === 0 ? b.h : b.w;
    let fs = Math.min(14, across * 0.55, (along * 1.6) / Math.max(2, u.code.length));
    if (!opts.forExport) fs = Math.max(fs, Math.min(11 / view.scale, across * 0.9));
    const rotT = u.rot % 180 === 0 ? '' : ` transform="rotate(-90 ${cx} ${cy})"`;
    const fill = u.type === 'wall' ? '#ffffff' : '#1a1a1a';
    s += `<text class="u-label" x="${cx}" y="${cy}" font-size="${fs.toFixed(1)}"
          text-anchor="middle" dominant-baseline="central" style="fill:${fill}"${rotT}>${esc(u.code)}</text>`;
  }

  // size readout when selected
  if (selected && sel.size === 1) {
    const fs = 10 / view.scale;
    s += `<text class="u-sub" x="${b.x + b.w / 2}" y="${b.y + b.h + fs * 1.3}" font-size="${fs.toFixed(2)}"
          text-anchor="middle">${fmtLen(u.w)} × ${fmtLen(u.d)}</text>`;
  }
  s += '</g>';
  return s;
}

function renderUnits() {
  gUnits.innerHTML = layout.units.map(u => unitMarkup(u)).join('');
}

function dimMarkup(side, info, editable) {
  // dimension line with end ticks + centered label
  if (!info || info.gap < 0.5) return '';
  const horiz = side === 'left' || side === 'right';
  let x1, y1, x2, y2;
  if (horiz) { y1 = y2 = info.at; x1 = info.x1; x2 = info.x2; }
  else { x1 = x2 = info.at; y1 = info.y1; y2 = info.y2; }
  const tick = 5 / view.scale;
  const fs = 12 / view.scale;
  const label = fmtLen(info.gap);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const cls = editable ? ' editable' : '';
  const attrs = editable ? ` data-dimside="${side}"` : '';
  const halfW = (label.length * fs * 0.34) + fs * 0.35;
  let s = `<g>`;
  s += `<line class="dim-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  if (horiz) {
    s += `<line class="dim-line" x1="${x1}" y1="${y1 - tick}" x2="${x1}" y2="${y1 + tick}"/>`;
    s += `<line class="dim-line" x1="${x2}" y1="${y2 - tick}" x2="${x2}" y2="${y2 + tick}"/>`;
  } else {
    s += `<line class="dim-line" x1="${x1 - tick}" y1="${y1}" x2="${x1 + tick}" y2="${y1}"/>`;
    s += `<line class="dim-line" x1="${x2 - tick}" y1="${y2}" x2="${x2 + tick}" y2="${y2}"/>`;
  }
  s += `<rect class="dim-halo${cls}"${attrs} x="${mx - halfW}" y="${my - fs * 0.75}" width="${halfW * 2}" height="${fs * 1.5}" rx="${fs * 0.25}"/>`;
  s += `<text class="dim-text${cls}"${attrs} x="${mx}" y="${my}" font-size="${fs.toFixed(2)}"
        text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
  s += `</g>`;
  return s;
}

function gapDims(box, others, editable) {
  const gaps = neighborGaps(box, others);
  let s = '';
  if (gaps.left)  s += dimMarkup('left',  { gap: gaps.left.gap,  at: gaps.left.at,  x1: gaps.left.edge,  x2: box.x }, editable);
  if (gaps.right) s += dimMarkup('right', { gap: gaps.right.gap, at: gaps.right.at, x1: box.x + box.w,   x2: gaps.right.edge }, editable);
  if (gaps.up)    s += dimMarkup('up',    { gap: gaps.up.gap,    at: gaps.up.at,    y1: gaps.up.edge,    y2: box.y }, editable);
  if (gaps.down)  s += dimMarkup('down',  { gap: gaps.down.gap,  at: gaps.down.at,  y1: box.y + box.h,   y2: gaps.down.edge }, editable);
  return s;
}

function renderOverlay() {
  let s = '';
  const units = selectedUnits();

  for (const u of units) {
    const b = aabb(u);
    s += `<rect class="sel-rect" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
  }

  for (const g of guides) {
    if (g.axis === 'v') s += `<line class="snap-guide" x1="${g.at}" y1="${g.from}" x2="${g.at}" y2="${g.to}"/>`;
    else s += `<line class="snap-guide" x1="${g.from}" y1="${g.at}" x2="${g.to}" y2="${g.at}"/>`;
  }

  // gap measurements for the selection (editable only for single selection at rest)
  if (units.length) {
    const box = selectionBBox(units);
    const others = layout.units.filter(u => !sel.has(u.id));
    s += gapDims(box, others, units.length === 1 && !drag);
  }

  gOverlay.innerHTML = s;
}

function renderGhost() {
  if (placing && placing.at) {
    const tpl = placing.tpl;
    const b = { x: placing.at.x, y: placing.at.y, w: tpl.rot % 180 ? tpl.d : tpl.w, h: tpl.rot % 180 ? tpl.w : tpl.d };
    gGhost.innerHTML = `<rect class="ghost-rect" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
  } else {
    gGhost.innerHTML = '';
  }
}

function renderStatus() {
  $('statZoom').textContent = Math.round(view.scale * 100 / 1.4) + '%';
  const n = sel.size;
  $('statSel').textContent = n ? `${n} selected` : '';
  let hint = '';
  if (placing) hint = 'Click to place — Esc to stop';
  else if (drag && drag.kind === 'unit') hint = 'Snapping to edges — hold Alt for free movement';
  else if (drag && drag.kind === 'extend') hint = drag.count
    ? `Adding ${drag.count} panel${drag.count === 1 ? '' : 's'} — release to place`
    : 'Drag along the aisle to add matching panels';
  else if (tool === 'label') hint = 'Click a unit and type its location code';
  else if (tool === 'duplicate') hint = 'Drag a unit to pull off a copy — a plain click copies beside it';
  else if (tool === 'extend') hint = 'Press on a panel and drag along the aisle to add matching panels';
  else if (tool === 'erase') hint = 'Click or drag across units to remove them';
  else if (tool === 'pan') hint = 'Drag to pan the floor';
  else if (!layout.units.length) hint = 'Drag a fixture in from the left to get started';
  $('statHint').textContent = hint;
}

function renderStatusPos(world) {
  $('statPos').textContent = world ? `${fmtLen(world.x)}, ${fmtLen(world.y)}` : '';
}

/* ============================== inspector ============================== */

let inspectorSyncing = false;

function renderInspector() {
  const units = selectedUnits();
  $('inspEmpty').classList.toggle('hidden', units.length > 0);
  $('inspBody').classList.toggle('hidden', units.length === 0);
  if (!units.length) return;

  inspectorSyncing = true;
  const one = units.length === 1 ? units[0] : null;
  const same = (get) => units.every(u => get(u) === get(units[0])) ? get(units[0]) : null;

  $('inspTitle').textContent = one
    ? (TYPES[one.type] ? TYPES[one.type].name : 'Unit')
    : `${units.length} units`;

  $('fieldCode').classList.toggle('hidden', !one);
  if (one && document.activeElement !== $('inCode')) $('inCode').value = one.code || '';

  const w = same(u => u.w);
  $('inWidthPreset').value = w === 48 ? '48' : w === 36 ? '36' : 'custom';
  if (document.activeElement !== $('inWidth')) $('inWidth').value = w == null ? '' : w;
  $('inWidth').placeholder = w == null ? 'mixed' : '';

  const d = same(u => u.d);
  if (document.activeElement !== $('inDepth')) $('inDepth').value = d == null ? '' : d;
  $('inDepth').placeholder = d == null ? 'mixed' : '';

  const rot = same(u => u.rot);
  for (const btn of $('rotSeg').querySelectorAll('button'))
    btn.classList.toggle('on', rot !== null && +btn.dataset.rot === rot);

  $('fieldPos').classList.toggle('hidden', !one);
  if (one) {
    if (document.activeElement !== $('inPosX')) $('inPosX').value = fmtLen(one.x);
    if (document.activeElement !== $('inPosY')) $('inPosY').value = fmtLen(one.y);
  }

  $('fieldAlign').classList.toggle('hidden', units.length < 2);
  inspectorSyncing = false;
}

function commitField(mutate) {
  const units = selectedUnits();
  if (!units.length || inspectorSyncing) return;
  pushUndo();
  for (const u of units) mutate(u);
  persist(); renderAll();
}

$('inCode').addEventListener('input', () => {
  const units = selectedUnits();
  if (units.length !== 1 || inspectorSyncing) return;
  units[0].code = $('inCode').value.trim();
  persist(); renderUnits();
});
$('inCode').addEventListener('focus', function () { this.select(); });
$('inCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('inCode').blur(); });

$('inWidthPreset').addEventListener('change', () => {
  const v = $('inWidthPreset').value;
  if (v === 'custom') { $('inWidth').focus(); return; }
  commitField(u => { u.w = +v; });
});
$('inWidth').addEventListener('change', () => {
  const v = Math.round(+$('inWidth').value);
  if (v >= 1 && v <= 1200) commitField(u => { u.w = v; });
});
$('inDepth').addEventListener('change', () => {
  const v = Math.round(+$('inDepth').value);
  if (v >= 1 && v <= 1200) commitField(u => { u.d = v; });
});

for (const btn of $('rotSeg').querySelectorAll('button')) {
  btn.addEventListener('click', () => {
    const rot = +btn.dataset.rot;
    commitField(u => setRotation(u, rot));
  });
}

function posInputHandler(axis) {
  return () => {
    const v = parseLen($(axis === 'x' ? 'inPosX' : 'inPosY').value);
    if (v === null) { renderInspector(); return; }
    commitField(u => { u[axis] = v; });
  };
}
$('inPosX').addEventListener('change', posInputHandler('x'));
$('inPosY').addEventListener('change', posInputHandler('y'));
for (const id of ['inPosX', 'inPosY'])
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(id).blur(); });

document.querySelectorAll('#fieldAlign button').forEach(btn => {
  btn.addEventListener('click', () => alignSelection(btn.dataset.align));
});

$('btnRotate').addEventListener('click', () => rotateSelection());
$('btnDup').addEventListener('click', () => duplicateSelection());
$('btnDelete').addEventListener('click', () => deleteSelection());

/* ============================== commands ============================== */

function setRotation(u, rot) {
  const b = aabb(u);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  u.rot = ((rot % 360) + 360) % 360;
  const nb = aabb(u);
  u.x = Math.round(cx - nb.w / 2);
  u.y = Math.round(cy - nb.h / 2);
}

function rotateSelection() {
  const units = selectedUnits();
  if (!units.length) return;
  pushUndo();
  for (const u of units) setRotation(u, u.rot + 90);
  persist(); renderAll();
}

function duplicateSelection() {
  const units = selectedUnits();
  if (!units.length) return;
  pushUndo();
  const clones = units.map(u => ({ ...u, id: uid(), x: u.x + 12, y: u.y + 12 }));
  layout.units.push(...clones);
  sel = new Set(clones.map(u => u.id));
  persist(); renderAll();
}

function deleteSelection() {
  if (!sel.size) return;
  pushUndo();
  layout.units = layout.units.filter(u => !sel.has(u.id));
  sel.clear();
  persist(); renderAll();
}

function nudgeSelection(dx, dy) {
  const units = selectedUnits();
  if (!units.length) return;
  pushUndo();
  for (const u of units) { u.x += dx; u.y += dy; }
  persist(); renderAll();
}

function alignSelection(mode) {
  const units = selectedUnits();
  if (units.length < 2) return;
  pushUndo();
  const box = selectionBBox(units);
  for (const u of units) {
    const b = aabb(u);
    switch (mode) {
      case 'l':  u.x = box.x; break;
      case 'r':  u.x = box.x + box.w - b.w; break;
      case 'cx': u.x = Math.round(box.x + (box.w - b.w) / 2); break;
      case 't':  u.y = box.y; break;
      case 'b':  u.y = box.y + box.h - b.h; break;
      case 'cy': u.y = Math.round(box.y + (box.h - b.h) / 2); break;
    }
  }
  persist(); renderAll();
}

function addUnit(tpl, x, y, select = true) {
  pushUndo();
  const u = {
    id: uid(), type: tpl.type, x: Math.round(x), y: Math.round(y),
    w: tpl.w, d: tpl.d, rot: tpl.rot || 0, code: '',
  };
  layout.units.push(u);
  if (select) sel = new Set([u.id]);
  persist(); renderAll();
  return u;
}

/* ============================== view controls ============================== */

function zoomAt(px, py, factor) {
  const w = toWorld(px, py);
  view.scale = clamp(view.scale * factor, 0.08, 16);
  view.x = w.x - px / view.scale;
  view.y = w.y - py / view.scale;
  requestRender();
}

function zoomCenter(factor) {
  const r = svg.getBoundingClientRect();
  zoomAt(r.width / 2, r.height / 2, factor);
}

function fitView() {
  const r = svg.getBoundingClientRect();
  const box = contentBBox();
  if (!box || !r.width) {
    view = { x: -40, y: -40, scale: 1.4 };
  } else {
    const pad = 48; // inches of margin
    const s = clamp(Math.min(r.width / (box.w + pad * 2), r.height / (box.h + pad * 2)), 0.08, 4);
    view.scale = s;
    view.x = box.x + box.w / 2 - r.width / 2 / s;
    view.y = box.y + box.h / 2 - r.height / 2 / s;
  }
  requestRender();
}

$('btnZoomIn').addEventListener('click', () => zoomCenter(1.25));
$('btnZoomOut').addEventListener('click', () => zoomCenter(0.8));
$('btnZoomFit').addEventListener('click', fitView);

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  if (e.ctrlKey || e.metaKey) {
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.002));
  } else {
    view.x += e.deltaX / view.scale;
    view.y += e.deltaY / view.scale;
    requestRender();
  }
}, { passive: false });

/* ============================== palette ============================== */

function buildPalette() {
  const host = $('paletteItems');
  host.innerHTML = '';
  PALETTE.forEach((tpl, i) => {
    const btn = document.createElement('button');
    btn.className = 'pal-item';
    btn.dataset.idx = i;
    const iw = 44, s = iw / 100;
    const rw = Math.min(96, tpl.w) * s, rh = Math.min(96, tpl.d) * s;
    const t = TYPES[tpl.type];
    btn.innerHTML = `
      <svg width="${iw}" height="30" viewBox="0 0 ${iw} 30">
        <rect x="${(iw - rw) / 2}" y="${(30 - rh) / 2}" width="${rw}" height="${rh}"
              fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.2"/>
      </svg>
      <span><span class="pal-name">${esc(tpl.label)}</span><br><span class="pal-desc">${esc(tpl.desc)}</span></span>`;
    btn.addEventListener('pointerdown', (e) => startPalette(e, tpl, btn));
    host.appendChild(btn);
  });
}

function armPalette(tpl, btn) {
  cancelPlacing();
  placing = { tpl: { ...tpl, rot: 0 }, at: null, sticky: true };
  document.querySelectorAll('.pal-item').forEach(b => b.classList.toggle('armed', b === btn));
  renderStatus();
}

function cancelPlacing() {
  placing = null;
  document.querySelectorAll('.pal-item').forEach(b => b.classList.remove('armed'));
  gGhost.innerHTML = '';
  renderStatus();
}

/* Drag-from-palette: pointerdown on item, place on release over canvas.
   A simple click (no real movement) arms sticky stamp mode instead. */
function startPalette(e, tpl, btn) {
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };
  let moved = false;
  const tplLive = { ...tpl, rot: 0 };

  const onMove = (ev) => {
    if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 6) moved = true;
    if (!moved) return;
    placing = placing && !placing.sticky ? placing : { tpl: tplLive, at: null, sticky: false };
    updateGhostFromClient(ev.clientX, ev.clientY);
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!moved) { armPalette(tpl, btn); return; }
    if (placing && placing.at) {
      const at = placing.at;
      cancelPlacing();
      addUnit(tplLive, at.x, at.y);
    } else {
      cancelPlacing();
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function updateGhostFromClient(cx, cy) {
  if (!placing) return;
  const r = svg.getBoundingClientRect();
  if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) {
    placing.at = null; renderGhost(); return;
  }
  const w = toWorld(cx - r.left, cy - r.top);
  const tpl = placing.tpl;
  const bw = tpl.rot % 180 ? tpl.d : tpl.w, bh = tpl.rot % 180 ? tpl.w : tpl.d;
  const raw = { x: w.x - bw / 2, y: w.y - bh / 2, w: bw, h: bh };
  const snapped = snapBox(raw, layout.units);
  placing.at = { x: snapped.x, y: snapped.y };
  guides = snapped.guides;
  renderGhost();
  gOverlay.innerHTML = guides.map(g => g.axis === 'v'
    ? `<line class="snap-guide" x1="${g.at}" y1="${g.from}" x2="${g.at}" y2="${g.to}"/>`
    : `<line class="snap-guide" x1="${g.from}" y1="${g.at}" x2="${g.to}" y2="${g.at}"/>`).join('')
    + gapDims({ x: snapped.x, y: snapped.y, w: bw, h: bh }, layout.units, false);
}

/* ============================== tools ============================== */

function setTool(name) {
  if (tool === name) return;
  tool = name;
  cancelPlacing();
  closeFloatEdit(false);
  drag = null;
  guides = [];
  gGhost.innerHTML = '';
  gScreen.innerHTML = '';
  svg.setAttribute('data-tool', name);
  document.querySelectorAll('#toolstrip button').forEach(b =>
    b.classList.toggle('on', b.dataset.tool === name));
  renderStatus();
}

document.querySelectorAll('#toolstrip button').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));

/* ============================== canvas interaction ============================== */

const pointers = new Map();

svg.addEventListener('pointerdown', (e) => {
  closeFloatEdit(false);
  closeLayoutMenu();
  svg.focus({ preventScroll: true });
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // second finger -> pinch
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    drag = {
      kind: 'pinch',
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    };
    guides = [];
    return;
  }

  const p = canvasPoint(e);
  const w = toWorld(p.x, p.y);

  // stamp mode: place a unit per click
  if (placing && placing.sticky) {
    updateGhostFromClient(e.clientX, e.clientY);
    if (placing.at) {
      const at = placing.at;
      const tpl = placing.tpl;
      addUnit(tpl, at.x, at.y);
      placing = { tpl, at, sticky: true }; // keep stamping
    }
    return;
  }

  // dimension label -> exact gap editor
  const dimEl = e.target.closest && e.target.closest('[data-dimside]');
  if (dimEl && sel.size === 1 && tool === 'select') {
    e.preventDefault(); // keep the default mousedown focus shift from blurring the editor
    openGapEditor(dimEl.getAttribute('data-dimside'), e);
    return;
  }

  const hit = e.target.closest && e.target.closest('[data-uid]');

  if (spaceHeld || e.button === 1 || tool === 'pan' || (!hit && e.pointerType === 'touch')) {
    drag = { kind: 'pan', last: { x: e.clientX, y: e.clientY } };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  if (tool === 'label') {
    if (hit) {
      e.preventDefault(); // openCodeEditor focuses the float input; don't let mousedown steal it back
      openCodeEditor(hit.getAttribute('data-uid'));
    } else if (sel.size) {
      sel.clear(); renderAll();
    }
    return;
  }

  if (tool === 'erase') {
    drag = { kind: 'erase', didPush: false };
    svg.setPointerCapture(e.pointerId);
    if (hit) eraseAt(hit.getAttribute('data-uid'));
    return;
  }

  if (tool === 'extend') {
    if (hit) {
      const src = unitById(hit.getAttribute('data-uid'));
      sel = new Set([src.id]);
      drag = { kind: 'extend', src, startW: w, count: 0, axis: 'x', dir: 1, pitch: 0 };
      svg.setPointerCapture(e.pointerId);
      renderAll();
    } else if (sel.size) {
      sel.clear(); renderAll();
    }
    return;
  }

  if (tool === 'duplicate') {
    if (hit) {
      const src = unitById(hit.getAttribute('data-uid'));
      pushUndo();
      const clone = { ...src, id: uid() };
      layout.units.push(clone);
      sel = new Set([clone.id]);
      renderAll();
      drag = {
        kind: 'unit', startW: w, moved: false, dupe: true, undoPushed: true,
        orig: [{ id: clone.id, x: clone.x, y: clone.y }],
        origBox: aabb(clone), clickedId: clone.id, shift: false,
      };
      svg.setPointerCapture(e.pointerId);
    } else if (sel.size) {
      sel.clear(); renderAll();
    }
    return;
  }

  if (hit) {
    const id = hit.getAttribute('data-uid');
    if (e.shiftKey) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      renderAll();
      if (!sel.has(id)) return;
    } else if (!sel.has(id)) {
      sel = new Set([id]);
      renderAll();
    }
    const units = selectedUnits();
    drag = {
      kind: 'unit',
      startW: w,
      moved: false,
      orig: units.map(u => ({ id: u.id, x: u.x, y: u.y })),
      origBox: selectionBBox(units),
      clickedId: id,
      shift: e.shiftKey,
    };
    svg.setPointerCapture(e.pointerId);
    return;
  }

  // empty floor: marquee (mouse/pen)
  if (!e.shiftKey) { sel.clear(); renderAll(); }
  drag = { kind: 'marquee', startW: w, curW: w, additive: e.shiftKey, base: new Set(sel) };
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = canvasPoint(e);
  const w = toWorld(p.x, p.y);
  renderStatusPos(w);

  if (placing && placing.sticky) { updateGhostFromClient(e.clientX, e.clientY); return; }
  if (!drag) return;

  if (drag.kind === 'pinch' && pointers.size === 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const r = svg.getBoundingClientRect();
    if (drag.dist > 10) zoomAt(mid.x - r.left, mid.y - r.top, dist / drag.dist);
    view.x -= (mid.x - drag.mid.x) / view.scale;
    view.y -= (mid.y - drag.mid.y) / view.scale;
    drag.dist = dist; drag.mid = mid;
    requestRender();
    return;
  }

  if (drag.kind === 'pan') {
    view.x -= (e.clientX - drag.last.x) / view.scale;
    view.y -= (e.clientY - drag.last.y) / view.scale;
    drag.last = { x: e.clientX, y: e.clientY };
    requestRender();
    return;
  }

  if (drag.kind === 'erase') {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const hit = el && el.closest && el.closest('[data-uid]');
    if (hit) eraseAt(hit.getAttribute('data-uid'));
    return;
  }

  if (drag.kind === 'extend') {
    const b = aabb(drag.src);
    const dx = w.x - drag.startW.x, dy = w.y - drag.startW.y;
    drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    drag.pitch = drag.axis === 'x' ? b.w : b.h;
    const dist = drag.axis === 'x' ? dx : dy;
    drag.dir = dist < 0 ? -1 : 1;
    drag.count = clamp(Math.round(Math.abs(dist) / drag.pitch), 0, 200);
    let s = '';
    for (let i = 1; i <= drag.count; i++) {
      const gx = b.x + (drag.axis === 'x' ? i * drag.pitch * drag.dir : 0);
      const gy = b.y + (drag.axis === 'y' ? i * drag.pitch * drag.dir : 0);
      s += `<rect class="ghost-rect" x="${gx}" y="${gy}" width="${b.w}" height="${b.h}"/>`;
    }
    if (drag.count) {
      const fs = 13 / view.scale;
      const lx = b.x + b.w / 2 + (drag.axis === 'x' ? drag.count * drag.pitch * drag.dir : 0);
      const ly = b.y + b.h / 2 + (drag.axis === 'y' ? drag.count * drag.pitch * drag.dir : 0);
      s += `<text class="dim-text" x="${lx}" y="${ly}" font-size="${fs.toFixed(2)}"
            text-anchor="middle" dominant-baseline="central">+${drag.count}</text>`;
    }
    gGhost.innerHTML = s;
    renderStatus();
    return;
  }

  if (drag.kind === 'unit') {
    const dx = w.x - drag.startW.x, dy = w.y - drag.startW.y;
    if (!drag.moved && Math.abs(dx) < 2 / view.scale && Math.abs(dy) < 2 / view.scale) return;
    if (!drag.moved) { drag.moved = true; if (!drag.undoPushed) pushUndo(); }
    const box = {
      x: drag.origBox.x + dx, y: drag.origBox.y + dy,
      w: drag.origBox.w, h: drag.origBox.h,
    };
    const others = layout.units.filter(u => !sel.has(u.id));
    const snapped = snapBox(box, others, { noEdges: e.altKey });
    const sdx = snapped.x - drag.origBox.x, sdy = snapped.y - drag.origBox.y;
    for (const o of drag.orig) {
      const u = unitById(o.id);
      if (u) { u.x = o.x + sdx; u.y = o.y + sdy; }
    }
    guides = snapped.guides;
    renderUnits(); renderOverlay(); renderStatus();
    return;
  }

  if (drag.kind === 'marquee') {
    drag.curW = w;
    const x1 = Math.min(drag.startW.x, w.x), y1 = Math.min(drag.startW.y, w.y);
    const x2 = Math.max(drag.startW.x, w.x), y2 = Math.max(drag.startW.y, w.y);
    sel = new Set(drag.additive ? drag.base : []);
    for (const u of layout.units) {
      const b = aabb(u);
      if (b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1) sel.add(u.id);
    }
    renderOverlay(); renderInspector(); renderStatus();
    const s = view.scale;
    gScreen.innerHTML = `<rect class="marquee" x="${(x1 - view.x) * s}" y="${(y1 - view.y) * s}"
      width="${(x2 - x1) * s}" height="${(y2 - y1) * s}"/>`;
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (drag.kind === 'pinch') { if (pointers.size < 2) drag = null; return; }

  if (drag.kind === 'unit') {
    if (drag.moved) {
      persist();
    } else if (drag.dupe) {
      const u = unitById(drag.clickedId); // plain click: place the copy just beside the original
      if (u) { u.x += 12; u.y += 12; }
      persist();
    } else if (!drag.shift) {
      sel = new Set([drag.clickedId]); // click without drag: collapse to that unit
    }
    guides = [];
    drag = null;
    renderAll();
    return;
  }
  if (drag.kind === 'extend') {
    if (drag.count > 0) {
      pushUndo();
      const clones = [];
      for (let i = 1; i <= drag.count; i++) {
        clones.push({
          ...drag.src, id: uid(), code: '',
          x: drag.src.x + (drag.axis === 'x' ? i * drag.pitch * drag.dir : 0),
          y: drag.src.y + (drag.axis === 'y' ? i * drag.pitch * drag.dir : 0),
        });
      }
      layout.units.push(...clones);
      sel = new Set(clones.map(u => u.id));
      persist();
    }
    gGhost.innerHTML = '';
    drag = null;
    renderAll();
    return;
  }
  if (drag.kind === 'erase') {
    if (drag.didPush) persist();
    drag = null;
    renderAll();
    return;
  }
  if (drag.kind === 'marquee') {
    gScreen.innerHTML = '';
    drag = null;
    renderAll();
    return;
  }
  drag = null;
}

function eraseAt(id) {
  const u = unitById(id);
  if (!u) return;
  if (drag && drag.kind === 'erase' && !drag.didPush) { pushUndo(); drag.didPush = true; }
  layout.units = layout.units.filter(x => x.id !== id);
  sel.delete(id);
  renderUnits(); renderOverlay(); renderInspector();
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);

svg.addEventListener('dblclick', (e) => {
  const hit = e.target.closest && e.target.closest('[data-uid]');
  if (hit) openCodeEditor(hit.getAttribute('data-uid'));
});

/* ============================== floating editor ============================== */

const floatEdit = $('floatEdit');
let floatCtx = null; // { kind:'code'|'gap', ... }

function openFloatAt(px, py, value, ctx) {
  floatCtx = ctx;
  floatEdit.value = value;
  floatEdit.classList.remove('hidden');
  const wrap = svg.parentElement.getBoundingClientRect();
  const r = svg.getBoundingClientRect();
  floatEdit.style.left = clamp(r.left - wrap.left + px - 45, 4, wrap.width - 100) + 'px';
  floatEdit.style.top = clamp(r.top - wrap.top + py - 14, 4, wrap.height - 40) + 'px';
  floatEdit.focus();
  floatEdit.select();
}

function openCodeEditor(id) {
  const u = unitById(id);
  if (!u) return;
  sel = new Set([id]);
  renderAll();
  const b = aabb(u);
  const px = (b.x + b.w / 2 - view.x) * view.scale;
  const py = (b.y + b.h / 2 - view.y) * view.scale;
  openFloatAt(px, py, u.code || '', { kind: 'code', id });
}

function openGapEditor(side, e) {
  const u = selectedUnits()[0];
  if (!u) return;
  const box = aabb(u);
  const others = layout.units.filter(x => x.id !== u.id);
  const gaps = neighborGaps(box, others);
  const g = gaps[side];
  if (!g) return;
  const p = canvasPoint(e);
  openFloatAt(p.x, p.y, String(Math.round(g.gap)), { kind: 'gap', id: u.id, side, edge: g.edge });
}

function closeFloatEdit(commit) {
  if (floatCtx === null) return;
  const ctx = floatCtx;
  floatCtx = null;
  floatEdit.classList.add('hidden');
  if (!commit) return;

  if (ctx.kind === 'code') {
    const u = unitById(ctx.id);
    if (u && u.code !== floatEdit.value.trim()) {
      pushUndo();
      u.code = floatEdit.value.trim();
      persist();
    }
    renderAll();
  } else if (ctx.kind === 'gap') {
    const v = parseLen(floatEdit.value);
    const u = unitById(ctx.id);
    if (v === null || v < 0 || !u) { renderAll(); return; }
    pushUndo();
    const b = aabb(u);
    switch (ctx.side) {
      case 'left':  u.x = Math.round(ctx.edge + v); break;
      case 'right': u.x = Math.round(ctx.edge - v - b.w); break;
      case 'up':    u.y = Math.round(ctx.edge + v); break;
      case 'down':  u.y = Math.round(ctx.edge - v - b.h); break;
    }
    persist(); renderAll();
  }
}

floatEdit.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') closeFloatEdit(true);
  else if (e.key === 'Escape') closeFloatEdit(false);
});
floatEdit.addEventListener('blur', () => closeFloatEdit(true));

/* ============================== keyboard ============================== */

function inTextInput() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !inTextInput()) {
    spaceHeld = true;
    svg.classList.add('panning');
    e.preventDefault();
    return;
  }
  if (inTextInput()) return;

  const mod = e.ctrlKey || e.metaKey;
  const step = e.shiftKey ? 12 : 1;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault(); redo();
  } else if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault(); duplicateSelection();
  } else if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    sel = new Set(layout.units.map(u => u.id));
    renderAll();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); deleteSelection();
  } else if (e.key.toLowerCase() === 'r' && !mod) {
    if (placing) { placing.tpl.rot = (placing.tpl.rot + 90) % 360; renderGhost(); }
    else rotateSelection();
  } else if (!mod && !drag && { v: 'select', h: 'pan', l: 'label', d: 'duplicate', e: 'extend', x: 'erase' }[e.key.toLowerCase()]) {
    setTool({ v: 'select', h: 'pan', l: 'label', d: 'duplicate', e: 'extend', x: 'erase' }[e.key.toLowerCase()]);
  } else if (e.key === 'ArrowLeft')  { e.preventDefault(); nudgeSelection(-step, 0); }
  else if (e.key === 'ArrowRight')   { e.preventDefault(); nudgeSelection(step, 0); }
  else if (e.key === 'ArrowUp')      { e.preventDefault(); nudgeSelection(0, -step); }
  else if (e.key === 'ArrowDown')    { e.preventDefault(); nudgeSelection(0, step); }
  else if (e.key === 'Escape') {
    if (placing) cancelPlacing();
    else if (tool !== 'select') setTool('select');
    else { sel.clear(); renderAll(); }
  } else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
  else if (e.key === '-') zoomCenter(0.8);
  else if (e.key === '0') fitView();
  else if (e.key === 'Enter' && sel.size === 1) {
    e.preventDefault();
    openCodeEditor([...sel][0]);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceHeld = false; svg.classList.remove('panning'); }
});

/* ============================== layouts menu ============================== */

function refreshLayoutSelect() {
  const selEl = $('layoutSelect');
  selEl.innerHTML = db.layouts
    .map(l => `<option value="${l.id}"${l.id === layout.id ? ' selected' : ''}>${esc(l.name)}</option>`)
    .join('');
}

function switchLayout(id) {
  const l = db.layouts.find(x => x.id === id);
  if (!l) return;
  layout = l;
  db.currentId = id;
  sel.clear(); undoStack = []; redoStack = []; updateUndoButtons();
  persist();
  refreshLayoutSelect();
  fitView();
}

$('layoutSelect').addEventListener('change', (e) => switchLayout(e.target.value));

$('btnLayoutMenu').addEventListener('click', (e) => {
  e.stopPropagation();
  $('layoutMenu').classList.toggle('hidden');
});
function closeLayoutMenu() { $('layoutMenu').classList.add('hidden'); }
window.addEventListener('click', (e) => {
  if (!e.target.closest || !e.target.closest('.layout-picker')) closeLayoutMenu();
});

$('layoutMenu').addEventListener('click', (e) => {
  const act = e.target.dataset && e.target.dataset.act;
  if (!act) return;
  closeLayoutMenu();
  if (act === 'new') {
    const name = prompt('Name for the new layout:', 'New layout');
    if (name === null) return;
    const l = newLayout(name.trim() || 'New layout');
    db.layouts.push(l);
    switchLayout(l.id);
  } else if (act === 'rename') {
    const name = prompt('Rename layout:', layout.name);
    if (name === null || !name.trim()) return;
    layout.name = name.trim();
    persist(); refreshLayoutSelect();
  } else if (act === 'duplicate') {
    const copy = JSON.parse(JSON.stringify(layout));
    copy.id = uid();
    copy.name = layout.name + ' (copy)';
    copy.units.forEach(u => { u.id = uid(); });
    db.layouts.push(copy);
    switchLayout(copy.id);
  } else if (act === 'delete') {
    if (!confirm(`Delete layout “${layout.name}”? This can't be undone.`)) return;
    db.layouts = db.layouts.filter(l => l.id !== layout.id);
    if (!db.layouts.length) db.layouts.push(newLayout('Store floor'));
    switchLayout(db.layouts[0].id);
  } else if (act === 'export') {
    exportJson();
  } else if (act === 'import') {
    $('importFile').click();
  }
});

function exportJson() {
  const blob = new Blob(
    [JSON.stringify({ app: 'ace-layout-studio', version: 1, layout }, null, 2)],
    { type: 'application/json' });
  downloadBlob(blob, safeFileName(layout.name) + '.layout.json');
}

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const l = data.layout && Array.isArray(data.layout.units) ? data.layout
      : (Array.isArray(data.units) ? data : null);
    if (!l) throw new Error('bad format');
    const imported = newLayout(l.name || file.name.replace(/\.layout\.json$|\.json$/i, ''));
    imported.units = l.units.map(u => ({
      id: uid(),
      type: TYPES[u.type] ? u.type : 'block',
      x: Math.round(+u.x || 0), y: Math.round(+u.y || 0),
      w: clamp(Math.round(+u.w || 48), 1, 1200),
      d: clamp(Math.round(+u.d || 24), 1, 1200),
      rot: [0, 90, 180, 270].includes(+u.rot) ? +u.rot : 0,
      code: String(u.code || '').slice(0, 40),
    }));
    db.layouts.push(imported);
    switchLayout(imported.id);
  } catch (err) {
    alert('Could not import that file — it doesn\'t look like an Ace Layout Studio export.');
  }
});

function safeFileName(s) {
  return (s || 'layout').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'layout';
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ============================== export PNG / print ============================== */

function exportSvgString() {
  const box = contentBBox();
  if (!box) return null;
  const pad = 36;
  const x = box.x - pad, y = box.y - pad, w = box.w + pad * 2, h = box.h + pad * 2;
  const scale = Math.min(6, 7600 / Math.max(w, h));
  const units = layout.units.map(u => unitMarkup(u, { forExport: true })).join('');
  const titleFs = Math.max(10, Math.min(20, w / 40));
  return {
    scale,
    w: Math.round(w * scale),
    h: Math.round(h * scale),
    svg:
`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="${x} ${y} ${w} ${h}">
<style>
  .u-rect { stroke-width: 1.4; vector-effect: non-scaling-stroke; }
  .u-label { font-family: Roboto, Arial, sans-serif; font-weight: 700; fill: #1a1a1a; }
  .u-divider { stroke: #BCBEC0; stroke-width: 1; vector-effect: non-scaling-stroke; }
  .bp-title { font-family: Roboto, Arial, sans-serif; font-weight: 900; fill: #6D6E71; }
</style>
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>
${gridExportMarkup(x, y, w, h)}
${units}
<text class="bp-title" x="${x + 10}" y="${y + titleFs + 6}" font-size="${titleFs}">${esc(layout.name)} — ${new Date().toLocaleDateString()}</text>
</svg>` };
}

function gridExportMarkup(x, y, w, h) {
  let s = '';
  const x0 = Math.ceil(x / 12) * 12, y0 = Math.ceil(y / 12) * 12;
  for (let gx = x0; gx <= x + w; gx += 12)
    s += `<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + h}" stroke="${gx % 48 === 0 ? '#dcdfe1' : '#eff0f1'}" stroke-width="${gx % 48 === 0 ? 0.7 : 0.4}"/>`;
  for (let gy = y0; gy <= y + h; gy += 12)
    s += `<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" stroke="${gy % 48 === 0 ? '#dcdfe1' : '#eff0f1'}" stroke-width="${gy % 48 === 0 ? 0.7 : 0.4}"/>`;
  return s;
}

function renderPng(cb) {
  const ex = exportSvgString();
  if (!ex) { alert('Nothing to export yet — place some fixtures first.'); return; }
  const img = new Image();
  const svgUrl = URL.createObjectURL(new Blob([ex.svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = ex.w; c.height = ex.h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(svgUrl);
    cb(c);
  };
  img.onerror = () => { URL.revokeObjectURL(svgUrl); alert('PNG export failed.'); };
  img.src = svgUrl;
}

$('btnPng').addEventListener('click', () => {
  renderPng((c) => c.toBlob((blob) =>
    downloadBlob(blob, safeFileName(layout.name) + '-blueprint.png'), 'image/png'));
});

$('btnPrint').addEventListener('click', () => {
  renderPng((c) => {
    const url = c.toDataURL('image/png');
    const f = document.createElement('iframe');
    f.style.position = 'fixed';
    f.style.right = '100%';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.write(`<!doctype html><title>${esc(layout.name)}</title>
      <style>@page{size:landscape;margin:.35in} html,body{height:100%;margin:0}
      img{max-width:100%;max-height:100%;display:block;margin:auto}</style>
      <img src="${url}">`);
    doc.close();
    const imgEl = doc.querySelector('img');
    imgEl.onload = () => {
      f.contentWindow.focus();
      f.contentWindow.print();
      setTimeout(() => f.remove(), 2000);
    };
  });
});

/* ============================== help ============================== */

$('btnHelp').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
$('btnHelpClose').addEventListener('click', () => $('helpModal').classList.add('hidden'));
$('helpModal').addEventListener('click', (e) => {
  if (e.target === $('helpModal')) $('helpModal').classList.add('hidden');
});

/* ============================== undo/redo buttons ============================== */

$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);

/* ============================== init ============================== */

window.addEventListener('resize', requestRender);

db = loadDb();
layout = db.layouts.find(l => l.id === db.currentId) || db.layouts[0];
db.currentId = layout.id;
svg.setAttribute('data-tool', tool);
document.querySelector('#toolstrip [data-tool="select"]').classList.add('on');
buildPalette();
refreshLayoutSelect();
updateUndoButtons();
if (layout.units.length) fitView(); else renderAll();
