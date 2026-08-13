import { clsx } from 'clsx';
import { useState } from 'react';
import type { BayMap } from '../model/types';
import { addressText, findBin } from '../model/layout';
import { ageDays, binFreshnessColor, binOldestPhysical } from '../model/freshness';
import { useBay } from '../store';
import { ArmedDelete, Button } from './ui';

export default function BinDetails({ map, binId }: { map: BayMap; binId: string }) {
  const {
    selectBin,
    setBinLabel,
    setBinNotes,
    setBinOverlay,
    addBinItem,
    updateBinItem,
    removeBinItem,
    clearBinItems,
  } = useBay.getState();
  const [clearArmed, setClearArmed] = useState(false);

  const found = findBin(map, binId);
  if (!found) return null;
  const { bin, address } = found;
  const isFloor = address.kind === 'floor';
  const oldest = binOldestPhysical(bin);
  const now = Date.now();

  return (
    <div className="flex h-full flex-col" data-testid="bin-details">
      <div className="flex items-center justify-between border-b border-[#e4e6e8] px-4 py-3">
        <h2 className="text-[13px] font-black tracking-[0.08em] text-[#15181d] uppercase">
          {isFloor ? 'Location details' : 'OPTI details'}
        </h2>
        <button
          type="button"
          data-testid="details-close"
          onClick={() => selectBin(null)}
          className="cursor-pointer rounded-md px-2 py-0.5 text-[13px] font-medium text-[#6d6e71] hover:bg-[#f3f4f5] hover:text-[#15181d]"
        >
          ← Overlays
        </button>
      </div>

      <div className="abs-scroll flex-1 overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            data-testid="bin-label"
            value={bin.label}
            onChange={(e) => setBinLabel(binId, e.target.value)}
            placeholder="—"
            maxLength={12}
            className="abs-input w-[104px] rounded-lg border border-[#d6d9dc] px-2 py-1 text-center text-[26px] font-black text-[#15181d]"
          />
          <div className="text-[12px] leading-snug text-[#6d6e71]">
            <div className="font-bold text-[#31353b] uppercase">{isFloor ? 'Location code' : 'OPTI number'}</div>
            {addressText(address)}
          </div>
        </div>

        {oldest && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-[#f7f8f9] px-2.5 py-1.5 text-[12px] text-[#31353b]" data-testid="bin-freshness">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-black/15"
              style={{ backgroundColor: binFreshnessColor(bin, map.freshness, now) ?? undefined }}
            />
            Last physical (oldest item): <b>{oldest}</b> — {ageDays(oldest, now)} days ago
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-bold tracking-[0.1em] text-[#8a9099] uppercase">Overlays</div>
          {map.overlays.length === 0 ? (
            <p className="text-[12px] text-[#6d6e71]">None yet — create overlays in the Overlays panel.</p>
          ) : (
            <div className="space-y-1">
              {map.overlays.map((o) => {
                const on = bin.overlayIds.includes(o.id);
                return (
                  <label
                    key={o.id}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-[13px]',
                      on ? 'border-[#cfd3d7] bg-[#f7f8f9]' : 'border-transparent hover:bg-[#f7f8f9]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setBinOverlay(binId, o.id, e.target.checked)}
                      className="accent-[#D40029]"
                    />
                    <span className="h-3.5 w-3.5 rounded-[4px] border border-black/15" style={{ backgroundColor: o.color }} />
                    <span className="text-[#31353b]">{o.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[0.1em] text-[#8a9099] uppercase">
              Contents{bin.items.length > 0 ? ` (${bin.items.length})` : ''}
            </span>
            <span className="flex items-center gap-1">
              {bin.items.length > 0 && (
                <ArmedDelete
                  armedLabel="Clear all"
                  armed={clearArmed}
                  setArmed={setClearArmed}
                  onConfirm={() => {
                    clearBinItems(binId);
                    setClearArmed(false);
                  }}
                  testid="clear-items"
                />
              )}
              <Button onClick={() => addBinItem(binId)} testid="add-item">
                + Item
              </Button>
            </span>
          </div>
          {bin.items.length === 0 ? (
            <p className="text-[12px] text-[#6d6e71]">
              Nothing on record. Add items here, or use <b>Import contents (CSV)</b> in the toolbar to
              load a whole spreadsheet at once.
            </p>
          ) : (
            <div className="space-y-1.5">
              {bin.items.map((it) => (
                <ItemRow
                  key={it.id}
                  name={it.name}
                  qty={it.qty}
                  sku={it.sku}
                  note={it.note}
                  lastPhysical={it.lastPhysical}
                  onChange={(patch) => updateBinItem(binId, it.id, patch)}
                  onRemove={() => removeBinItem(binId, it.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 pb-2">
          <div className="mb-1.5 text-[11px] font-bold tracking-[0.1em] text-[#8a9099] uppercase">Notes</div>
          <textarea
            data-testid="bin-notes"
            value={bin.notes}
            onChange={(e) => setBinNotes(binId, e.target.value)}
            placeholder="Anything worth remembering about this OPTI…"
            rows={3}
            className="abs-input w-full resize-y rounded-md border border-[#d6d9dc] px-2 py-1.5 text-[13px] text-[#31353b]"
          />
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  name,
  qty,
  sku,
  note,
  lastPhysical,
  onChange,
  onRemove,
}: {
  name: string;
  qty: string;
  sku: string;
  note: string;
  lastPhysical: string;
  onChange: (patch: { name?: string; qty?: string; sku?: string; note?: string; lastPhysical?: string }) => void;
  onRemove: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const field =
    'abs-input rounded-md border border-[#e0e2e5] px-1.5 py-1 text-[12px] text-[#31353b] placeholder:text-[#b9bec5]';
  return (
    <div data-testid="item-row" className="rounded-lg border border-[#e4e6e8] bg-[#fafbfb] p-1.5">
      <div className="flex items-center gap-1.5">
        <input
          data-testid="item-name"
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Item"
          className={clsx(field, 'w-full min-w-0 font-medium')}
        />
        <ArmedDelete armedLabel="Remove" armed={armed} setArmed={setArmed} onConfirm={onRemove} testid="item-delete" />
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          value={qty}
          onChange={(e) => onChange({ qty: e.target.value })}
          placeholder="Qty"
          className={clsx(field, 'w-[48px] text-center')}
        />
        <input
          value={sku}
          onChange={(e) => onChange({ sku: e.target.value })}
          placeholder="SKU"
          className={clsx(field, 'w-[88px]')}
        />
        <input
          data-testid="item-lastphys"
          value={lastPhysical}
          onChange={(e) => onChange({ lastPhysical: e.target.value })}
          placeholder="Last phys."
          title="Date Last Physical (from Eagle) — YYYY-MM-DD or MM/DD/YYYY"
          className={clsx(field, 'w-full min-w-0')}
        />
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          value={note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Note"
          className={clsx(field, 'w-full min-w-0')}
        />
      </div>
    </div>
  );
}
