import { clsx } from 'clsx';
import { useEffect } from 'react';
import type { Aisle, Bank, BayMap, Bin, Overlay } from '../model/types';
import { addressText, sideLabel } from '../model/layout';
import { binMatches, useBay } from '../store';

/** Translucent wash — enough to read the color, label stays legible. */
const wash = (hex: string) => `${hex}70`;

function BinIcon({
  bin,
  aisle,
  bank,
  shelf,
  slot,
  overlays,
}: {
  bin: Bin;
  aisle: Aisle;
  bank: Bank;
  shelf: number;
  slot: number;
  overlays: Overlay[];
}) {
  const tool = useBay((s) => s.tool);
  const stroke = useBay((s) => s.stroke);
  const search = useBay((s) => s.search);
  const selectedBinId = useBay((s) => s.selectedBinId);
  const { beginStroke, strokeOver, selectBin, showToast } = useBay.getState();

  const visible = bin.overlayIds
    .map((id) => overlays.find((o) => o.id === id))
    .filter((o): o is Overlay => !!o && o.visible);
  const first = visible[0];
  const searching = search.trim() !== '';
  const matched = searching && binMatches(bin, search);
  const dimmed = searching && !matched;
  const selected = selectedBinId === bin.id;

  const tooltip = [
    bin.label ? `OPTI ${bin.label}` : 'Unlabeled OPTI',
    addressText({ aisleId: aisle.id, aisleName: aisle.name, side: bank.side, shelf, slot }),
    bin.items.length > 0 ? `${bin.items.length} item${bin.items.length === 1 ? '' : 's'} on record` : '',
    visible.length > 0 ? `Overlays: ${visible.map((o) => o.name).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      data-testid="bin"
      data-label={bin.label}
      title={tooltip}
      onPointerDown={(e) => {
        if (tool === 'paint') {
          e.preventDefault();
          if (overlays.length === 0) {
            showToast('Create an overlay first — top of the right panel.');
            return;
          }
          beginStroke(bin.id);
        } else {
          selectBin(selected ? null : bin.id);
        }
      }}
      onPointerEnter={(e) => {
        if (tool === 'paint' && stroke && (e.buttons & 1) === 1) strokeOver(bin.id);
      }}
      className={clsx(
        'relative h-[52px] min-w-0 touch-none rounded-[6px] border transition-opacity',
        'border-[#c6cad0] bg-gradient-to-b from-[#f7f8f9] to-[#e8eaed]',
        tool === 'paint' ? 'cursor-crosshair' : 'cursor-pointer',
        dimmed && 'opacity-20',
        matched && 'ring-2 ring-[#D40029] ring-offset-1',
        selected && 'ring-2 ring-[#15181d] ring-offset-2',
      )}
    >
      {/* the container's top lip */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[7px] rounded-t-[5px] border-b border-[#c6cad0] bg-[#dde0e4]" />

      {/* overlay wash */}
      {first && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[5px] border-2"
          style={{ backgroundColor: wash(first.color), borderColor: first.color }}
        />
      )}

      {/* the painted OPTI number */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[5px]">
        <span className="text-[19px] font-black tracking-tight text-[#33383f]">{bin.label}</span>
      </div>

      {/* extra visible overlays beyond the first */}
      {visible.length > 1 && (
        <div className="pointer-events-none absolute bottom-[3px] left-[4px] flex gap-[3px]">
          {visible.slice(1, 5).map((o) => (
            <span
              key={o.id}
              className="h-[7px] w-[7px] rounded-full border border-white/70"
              style={{ backgroundColor: o.color }}
            />
          ))}
        </div>
      )}

      {/* items-on-record badge */}
      {bin.items.length > 0 && (
        <div
          data-testid="item-badge"
          className="pointer-events-none absolute right-[3px] bottom-[2px] rounded-[4px] bg-[#15181d]/75 px-[4px] text-[9px] leading-[14px] font-bold text-white"
        >
          {bin.items.length}
        </div>
      )}
    </div>
  );
}

function BankView({ aisle, bank, overlays }: { aisle: Aisle; bank: Bank; overlays: Overlay[] }) {
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
                <BinIcon
                  key={bin.id}
                  bin={bin}
                  aisle={aisle}
                  bank={bank}
                  shelf={s + 1}
                  slot={p + 1}
                  overlays={overlays}
                />
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

function AisleCard({ aisle, overlays }: { aisle: Aisle; overlays: Overlay[] }) {
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
    <section
      data-testid="aisle"
      className="rounded-xl border border-[#e0e2e5] bg-white p-4 shadow-sm"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-black tracking-wide text-[#15181d] uppercase">{aisle.name}</h2>
        <span className="rounded-full bg-[#f3f4f5] px-2.5 py-0.5 text-[11px] font-bold text-[#6d6e71]">
          {labeled} / {total} labeled
        </span>
      </header>
      {left && <BankView aisle={aisle} bank={left} overlays={overlays} />}
      {left && right && (
        <div className="my-2 flex items-center gap-3">
          <div className="h-0 flex-1 border-t border-dashed border-[#c6cad0]" />
          <span className="text-[9px] font-bold tracking-[0.25em] text-[#9aa1a8] uppercase">walkway</span>
          <div className="h-0 flex-1 border-t border-dashed border-[#c6cad0]" />
        </div>
      )}
      {right && <BankView aisle={aisle} bank={right} overlays={overlays} />}
    </section>
  );
}

export default function BayMapView({ map }: { map: BayMap }) {
  const endStroke = useBay((s) => s.endStroke);

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

  return (
    <div className="abs-nosel grid grid-cols-1 gap-4 2xl:grid-cols-2">
      {map.aisles.map((aisle) => (
        <AisleCard key={aisle.id} aisle={aisle} overlays={map.overlays} />
      ))}
      {map.aisles.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#c6cad0] p-10 text-center text-[14px] text-[#6d6e71]">
          No aisles yet — add one in Settings.
        </div>
      )}
    </div>
  );
}
