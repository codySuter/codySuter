import { clsx } from 'clsx';
import { useEffect } from 'react';
import type { Aisle, Bank, BayMap, Bin, Overlay } from '../model/types';
import { addressText, sideLabel } from '../model/layout';
import { ageDays, binFreshnessColor, binOldestPhysical } from '../model/freshness';
import { binMatches, useBay } from '../store';

/** Translucent wash — enough to read the color, label stays legible. */
const wash = (hex: string) => `${hex}70`;

interface WashInfo {
  /** Wash + border color, or null for a plain bin. */
  color: string | null;
  /** Manual overlays beyond the one drawn (shown as dots). */
  extraDots: Overlay[];
  fresh: { oldest: string; days: number } | null;
}

/**
 * What covers a bin: the freshness preset wins wherever it has data
 * (that's the point of turning it on); manual overlays otherwise.
 */
function washInfo(bin: Bin, map: BayMap, now: number): WashInfo {
  const oldest = binOldestPhysical(bin);
  const fresh = oldest ? { oldest, days: ageDays(oldest, now) } : null;
  const visible = bin.overlayIds
    .map((id) => map.overlays.find((o) => o.id === id))
    .filter((o): o is Overlay => !!o && o.visible);
  if (map.freshness.enabled && fresh) {
    return { color: binFreshnessColor(bin, map.freshness, now), extraDots: visible, fresh };
  }
  return { color: visible[0]?.color ?? null, extraDots: visible.slice(1), fresh };
}

function binTooltip(bin: Bin, map: BayMap, place: string, info: WashInfo): string {
  const names = bin.overlayIds
    .map((id) => map.overlays.find((o) => o.id === id)?.name)
    .filter(Boolean);
  return [
    bin.label ? `${place.startsWith('Sales') ? 'Location' : 'OPTI'} ${bin.label}` : `Unlabeled — ${place}`,
    bin.label ? place : '',
    bin.items.length > 0 ? `${bin.items.length} item${bin.items.length === 1 ? '' : 's'} on record` : '',
    info.fresh ? `Last physical (oldest item): ${info.fresh.oldest} — ${info.fresh.days} days ago` : '',
    names.length > 0 ? `Overlays: ${names.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Shared interaction + wash chrome for both bay bins and floor tiles. */
function useBinHandlers(bin: Bin) {
  const tool = useBay((s) => s.tool);
  const stroke = useBay((s) => s.stroke);
  const selectedBinId = useBay((s) => s.selectedBinId);
  const { beginStroke, strokeOver, selectBin, showToast } = useBay.getState();
  return {
    tool,
    selected: selectedBinId === bin.id,
    onPointerDown: (e: React.PointerEvent, hasOverlays: boolean) => {
      if (tool === 'paint') {
        e.preventDefault();
        if (!hasOverlays) {
          showToast('Create an overlay first — top of the right panel.');
          return;
        }
        beginStroke(bin.id);
      } else {
        selectBin(selectedBinId === bin.id ? null : bin.id);
      }
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (tool === 'paint' && stroke && (e.buttons & 1) === 1) strokeOver(bin.id);
    },
  };
}

function WashLayer({ info }: { info: WashInfo }) {
  return (
    <>
      {info.color && (
        <div
          data-testid="wash"
          className="pointer-events-none absolute inset-0 rounded-[5px] border-2"
          style={{ backgroundColor: wash(info.color), borderColor: info.color }}
        />
      )}
      {info.extraDots.length > 0 && (
        <div className="pointer-events-none absolute bottom-[3px] left-[4px] flex gap-[3px]">
          {info.extraDots.slice(0, 4).map((o) => (
            <span
              key={o.id}
              className="h-[7px] w-[7px] rounded-full border border-white/70"
              style={{ backgroundColor: o.color }}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ItemBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div
      data-testid="item-badge"
      className="pointer-events-none absolute right-[3px] bottom-[2px] rounded-[4px] bg-[#15181d]/75 px-[4px] text-[9px] leading-[14px] font-bold text-white"
    >
      {count}
    </div>
  );
}

function BinIcon({
  bin,
  aisle,
  bank,
  shelf,
  slot,
  map,
  now,
}: {
  bin: Bin;
  aisle: Aisle;
  bank: Bank;
  shelf: number;
  slot: number;
  map: BayMap;
  now: number;
}) {
  const search = useBay((s) => s.search);
  const h = useBinHandlers(bin);
  const info = washInfo(bin, map, now);
  const searching = search.trim() !== '';
  const matched = searching && binMatches(bin, search);

  return (
    <div
      data-testid="bin"
      data-label={bin.label}
      title={binTooltip(
        bin,
        map,
        addressText({ kind: 'bay', aisleId: aisle.id, aisleName: aisle.name, side: bank.side, shelf, slot }),
        info,
      )}
      onPointerDown={(e) => h.onPointerDown(e, map.overlays.length > 0)}
      onPointerEnter={h.onPointerEnter}
      className={clsx(
        'relative h-[52px] min-w-0 touch-none rounded-[6px] border transition-opacity',
        'border-[#c6cad0] bg-gradient-to-b from-[#f7f8f9] to-[#e8eaed]',
        h.tool === 'paint' ? 'cursor-crosshair' : 'cursor-pointer',
        searching && !matched && 'opacity-20',
        matched && 'ring-2 ring-[#D40029] ring-offset-1',
        h.selected && 'ring-2 ring-[#15181d] ring-offset-2',
      )}
    >
      {/* the container's top lip */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[7px] rounded-t-[5px] border-b border-[#c6cad0] bg-[#dde0e4]" />
      <WashLayer info={info} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[5px]">
        <span className="text-[19px] font-black tracking-tight text-[#33383f]">{bin.label}</span>
      </div>
      <ItemBadge count={bin.items.length} />
    </div>
  );
}

function FloorTile({ bin, map, now }: { bin: Bin; map: BayMap; now: number }) {
  const search = useBay((s) => s.search);
  const h = useBinHandlers(bin);
  const info = washInfo(bin, map, now);
  const searching = search.trim() !== '';
  const matched = searching && binMatches(bin, search);
  const numeric = /^\d+$/.test(bin.label.trim());

  return (
    <div
      data-testid="floor-loc"
      data-label={bin.label}
      title={binTooltip(bin, map, 'Sales floor location', info)}
      onPointerDown={(e) => h.onPointerDown(e, map.overlays.length > 0)}
      onPointerEnter={h.onPointerEnter}
      className={clsx(
        'relative flex h-[68px] min-w-0 touch-none flex-col items-center justify-center rounded-lg border px-1',
        'border-[#c6cad0] bg-gradient-to-b from-[#ffffff] to-[#eef0f2]',
        h.tool === 'paint' ? 'cursor-crosshair' : 'cursor-pointer',
        searching && !matched && 'opacity-20',
        matched && 'ring-2 ring-[#D40029] ring-offset-1',
        h.selected && 'ring-2 ring-[#15181d] ring-offset-2',
      )}
    >
      <WashLayer info={info} />
      {numeric && (
        <span className="pointer-events-none text-[9px] font-bold tracking-[0.22em] text-[#8a9099] uppercase">
          aisle
        </span>
      )}
      <span className="pointer-events-none max-w-full truncate text-center text-[20px] leading-tight font-black tracking-tight text-[#33383f]">
        {bin.label || '—'}
      </span>
      <ItemBadge count={bin.items.length} />
    </div>
  );
}

function BankView({ aisle, bank, map, now }: { aisle: Aisle; bank: Bank; map: BayMap; now: number }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold tracking-[0.18em] text-[#8a9099] uppercase">
        {sideLabel(bank.side)}
      </div>
      <div className="flex flex-col">
        {bank.shelves.map((row, s) => (
          <div key={s}>
            <div
              className="grid gap-[6px]"
              style={{ gridTemplateColumns: `repeat(${row.length}, minmax(40px, 1fr))` }}
            >
              {row.map((bin, p) => (
                <BinIcon key={bin.id} bin={bin} aisle={aisle} bank={bank} shelf={s + 1} slot={p + 1} map={map} now={now} />
              ))}
            </div>
            {/* the shelf beam the row sits on */}
            <div className="mt-[3px] mb-[7px] h-[5px] rounded-[2px] bg-[#aeb3b9]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AisleCard({ aisle, map, now }: { aisle: Aisle; map: BayMap; now: number }) {
  let total = 0;
  let labeled = 0;
  for (const bank of aisle.banks)
    for (const row of bank.shelves)
      for (const bin of row) {
        total++;
        if (bin.label.trim() !== '') labeled++;
      }
  const left = aisle.banks.find((b) => b.side === 'left');
  const right = aisle.banks.find((b) => b.side === 'right');
  return (
    <section data-testid="aisle" className="rounded-xl border border-[#e0e2e5] bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-black tracking-wide text-[#15181d] uppercase">{aisle.name}</h2>
        <span className="rounded-full bg-[#f3f4f5] px-2.5 py-0.5 text-[11px] font-bold text-[#6d6e71]">
          {labeled} / {total} labeled
        </span>
      </header>
      {left && <BankView aisle={aisle} bank={left} map={map} now={now} />}
      {left && right && (
        <div className="my-2 flex items-center gap-3">
          <div className="h-0 flex-1 border-t border-dashed border-[#c6cad0]" />
          <span className="text-[9px] font-bold tracking-[0.25em] text-[#9aa1a8] uppercase">walkway</span>
          <div className="h-0 flex-1 border-t border-dashed border-[#c6cad0]" />
        </div>
      )}
      {right && <BankView aisle={aisle} bank={right} map={map} now={now} />}
    </section>
  );
}

export default function BayMapView({ map }: { map: BayMap }) {
  const area = useBay((s) => s.area);
  const endStroke = useBay((s) => s.endStroke);
  const now = Date.now();

  // A paint sweep ends wherever the pointer is let go.
  useEffect(() => {
    const up = () => endStroke();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [endStroke]);

  if (area === 'floor') {
    return (
      <div className="abs-nosel">
        <section className="rounded-xl border border-[#e0e2e5] bg-white p-4 shadow-sm">
          <header className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-black tracking-wide text-[#15181d] uppercase">Sales floor</h2>
            <span className="rounded-full bg-[#f3f4f5] px-2.5 py-0.5 text-[11px] font-bold text-[#6d6e71]">
              {map.floor.length} locations
            </span>
          </header>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {map.floor.map((bin) => (
              <FloorTile key={bin.id} bin={bin} map={map} now={now} />
            ))}
          </div>
          {map.floor.length === 0 && (
            <p className="py-6 text-center text-[13px] text-[#6d6e71]">
              No locations yet — add aisles in Layout.
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="abs-nosel grid grid-cols-1 gap-4 2xl:grid-cols-2">
      {map.aisles.map((aisle) => (
        <AisleCard key={aisle.id} aisle={aisle} map={map} now={now} />
      ))}
      {map.aisles.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#c6cad0] p-10 text-center text-[14px] text-[#6d6e71]">
          No aisles yet — add one in Settings.
        </div>
      )}
    </div>
  );
}
