import { useEffect, useRef, useState } from 'react';
import type { FixtureHeat } from '../model/heat';
import { NEVER_FILL, NO_DATA_FILL, heatColor, inkFor, metricById } from '../model/heat';
import { ENTRANCE, FIXTURES, PLAN_H, PLAN_W, ROOMS, TABLES, WALLS, type Fixture } from '../model/floorplan';
import type { HeatSettings } from '../model/types';
import { useFloor } from '../store';

const WALL_INK = '#5B5E63';

interface View {
  x: number;
  y: number;
  k: number;
}

function fitView(el: HTMLElement): View {
  const k = Math.min(el.clientWidth / PLAN_W, el.clientHeight / PLAN_H) * 0.98;
  return { k, x: (el.clientWidth - PLAN_W * k) / 2, y: (el.clientHeight - PLAN_H * k) / 2 };
}

function FixtureShape({
  f,
  heat,
  settings,
  hits,
  metricLabel,
}: {
  f: Fixture;
  heat: FixtureHeat | undefined;
  settings: HeatSettings;
  hits: Set<string> | null;
  metricLabel: string;
}) {
  const selectedId = useFloor((s) => s.selectedId);
  const metric = metricById(settings.metricId);

  // value === null means "never" on an age metric (hatched) but "no
  // usable values" on a pct metric (neutral, still counted as covered).
  const never = !!heat && heat.value === null && metric.kind === 'age';
  const noValue = !!heat && heat.value === null && metric.kind !== 'age';
  const fill = !heat || noValue ? NO_DATA_FILL : never ? 'url(#afs-never)' : heatColor(metric.kind, settings.ramp, heat.t);
  const ink =
    !heat || noValue ? '#9AA1A8' : inkFor(never ? NEVER_FILL : heatColor(metric.kind, settings.ramp, heat.t));
  const selected = selectedId === f.id;
  const hit = hits?.has(f.id) ?? false;
  const dimmed = hits !== null && !hit;

  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const label = f.label ?? f.id;
  const fontSize = f.fontSize ?? (f.vertical ? 12 : 11);
  const showValue = settings.showValues && !!heat && !f.vertical && f.h >= 24;

  const tooltip = [
    label,
    heat
      ? `${metricLabel}: ${never ? 'never' : noValue ? 'no usable values' : heat.text} · ${heat.skuCount} SKU${heat.skuCount === 1 ? '' : 's'}`
      : 'No SKUs in this import',
    heat && heat.neverCount > 0 && heat.value !== null ? `${heat.neverCount} never counted` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <g
      data-testid="fixture"
      data-loc={f.id}
      data-days={heat && metric.kind === 'age' && heat.value !== null ? Math.round(heat.value) : undefined}
      data-value={heat && heat.value !== null ? String(Math.round(heat.value)) : undefined}
      data-never={never ? 'true' : undefined}
      opacity={dimmed ? 0.16 : 1}
      style={{ cursor: 'pointer' }}
      onClick={() => useFloor.getState().select(selected ? null : f.id)}
    >
      <title>{tooltip}</title>
      <rect
        x={f.x}
        y={f.y}
        width={f.w}
        height={f.h}
        rx={3}
        fill={fill}
        stroke={selected ? '#15181D' : hit ? '#D40029' : '#B4B9BF'}
        strokeWidth={selected || hit ? 3.5 : 1}
      />
      <text
        x={cx}
        y={showValue ? cy - 5 : cy}
        transform={f.vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        fill={ink}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
      {showValue && (
        <text
          x={cx}
          y={cy + 8}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fontWeight={500}
          fill={ink}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {heat.text}
        </text>
      )}
      {heat && heat.neverCount > 0 && heat.value !== null && metric.kind === 'age' && (
        <circle cx={f.x + f.w - 5} cy={f.y + 5} r={4} fill={NEVER_FILL} stroke="#fff" strokeWidth={1.2} />
      )}
    </g>
  );
}

export default function FloorMapView({
  heat,
  settings,
  hits,
}: {
  heat: Map<string, FixtureHeat>;
  settings: HeatSettings;
  hits: Set<string> | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 0.5 });
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null);
  const metricLabel = metricById(settings.metricId).label;

  // Fit on mount, and keep refitting on window resizes until the user
  // takes over the view with their own pan/zoom.
  const userDrove = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setView(fitView(el));
    const ro = new ResizeObserver(() => {
      if (!userDrove.current) setView(fitView(el));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom toward the cursor. React's onWheel is passive — attach by hand.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userDrove.current = true;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const k = Math.min(8, Math.max(0.15, v.k * factor));
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={wrapRef}
      data-testid="floor-map"
      className="afs-nosel relative h-full w-full overflow-hidden bg-[#F4F4F6]"
      onPointerDown={(e) => {
        drag.current = { px: e.clientX, py: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        if (!drag.current || (e.buttons & 1) !== 1) return;
        const dx = e.clientX - drag.current.px;
        const dy = e.clientY - drag.current.py;
        if (!drag.current.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          drag.current.moved = true;
          userDrove.current = true;
          // Capture only once a pan starts — capturing on pointerdown
          // would retarget the click and break selecting a fixture.
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        if (!drag.current.moved) return;
        drag.current.px = e.clientX;
        drag.current.py = e.clientY;
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onClickCapture={(e) => {
        // A pan that ended on a fixture must not select it.
        if (drag.current?.moved) e.stopPropagation();
      }}
    >
      <svg width="100%" height="100%" data-testid="floor-svg">
        <defs>
          <pattern id="afs-never" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="9" height="9" fill={NEVER_FILL} />
            <rect width="4.5" height="9" fill="#8A1F35" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={60} y={60} width={PLAN_W - 120} height={PLAN_H - 104} fill="#FBFBFC" />
          {WALLS.map((w, i) => (
            <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={WALL_INK} strokeWidth={10} strokeLinecap="square" />
          ))}
          {ROOMS.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="#FFFFFF" stroke={WALL_INK} strokeWidth={8} />
          ))}
          {TABLES.map((t, i) => (
            <rect key={i} x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke="#C9CCD1" strokeWidth={2} strokeDasharray="7 5" />
          ))}
          <g>
            <rect x={ENTRANCE.x} y={ENTRANCE.y} width={ENTRANCE.w} height={ENTRANCE.h} fill="#6D6E71" />
            <text
              x={ENTRANCE.x + ENTRANCE.w / 2}
              y={ENTRANCE.y + ENTRANCE.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={15}
              fontWeight={900}
              letterSpacing={3}
              fill="#fff"
            >
              {ENTRANCE.label}
            </text>
          </g>
          {FIXTURES.map((f) => (
            <FixtureShape key={f.id} f={f} heat={heat.get(f.id)} settings={settings} hits={hits} metricLabel={metricLabel} />
          ))}
        </g>
      </svg>

      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-md border border-[#d6d9dc] bg-white shadow-sm">
        {(
          [
            ['+', (v: View, el: HTMLElement) => zoomAt(v, el, 1.3)],
            ['−', (v: View, el: HTMLElement) => zoomAt(v, el, 1 / 1.3)],
            ['⤢', (_v: View, el: HTMLElement) => fitView(el)],
          ] as const
        ).map(([glyph, fn], i) => (
          <button
            key={glyph}
            type="button"
            title={i === 2 ? 'Fit to window' : i === 0 ? 'Zoom in' : 'Zoom out'}
            onClick={() => {
              if (!wrapRef.current) return;
              userDrove.current = i !== 2; // Fit hands the view back to auto-refit
              setView((v) => fn(v, wrapRef.current!));
            }}
            className={`h-9 w-9 cursor-pointer text-[16px] font-bold text-[#31353b] hover:bg-[#f5f6f7] ${i > 0 ? 'border-t border-[#e4e6e8]' : ''}`}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}

function zoomAt(v: View, el: HTMLElement, factor: number): View {
  const k = Math.min(8, Math.max(0.15, v.k * factor));
  const mx = el.clientWidth / 2;
  const my = el.clientHeight / 2;
  return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
}
