import { clsx } from 'clsx';
import { useState } from 'react';
import type { BayMap, Overlay } from '../model/types';
import { OVERLAY_COLORS, overlayBinCount, useBay } from '../store';
import { ArmedDelete, Button } from './ui';

function Swatch({ color, onPick, active }: { color: string; onPick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={clsx(
        'h-6 w-6 cursor-pointer rounded-md border',
        active ? 'border-[#15181d] ring-2 ring-[#15181d]/30' : 'border-black/15 hover:scale-110',
      )}
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}

function OverlayRow({ overlay, map }: { overlay: Overlay; map: BayMap }) {
  const activeOverlayId = useBay((s) => s.activeOverlayId);
  const { setActiveOverlay, setTool, updateOverlay, removeOverlay } = useBay.getState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const active = activeOverlayId === overlay.id;
  const count = overlayBinCount(map, overlay.id);

  return (
    <div
      data-testid="overlay-row"
      onClick={() => {
        setActiveOverlay(overlay.id);
        setTool('paint');
      }}
      className={clsx(
        'relative cursor-pointer rounded-lg border px-2 py-1.5',
        active ? 'border-[#D40029] bg-[#fff5f7]' : 'border-[#e4e6e8] bg-white hover:border-[#cfd3d7]',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Change color"
          onClick={() => setPickerOpen((v) => !v)}
          className="h-6 w-6 shrink-0 cursor-pointer rounded-md border border-black/15"
          style={{ backgroundColor: overlay.color }}
        />
        <input
          data-testid="overlay-name"
          value={overlay.name}
          onChange={(e) => updateOverlay(overlay.id, { name: e.target.value })}
          onFocus={() => {
            setActiveOverlay(overlay.id);
            setTool('paint');
          }}
          className="abs-input w-full min-w-0 rounded-md border border-transparent px-1 py-0.5 text-[13px] font-medium text-[#15181d] hover:border-[#e4e6e8]"
        />
        <span className="shrink-0 rounded-full bg-[#f3f4f5] px-2 py-0.5 text-[11px] font-bold text-[#6d6e71]" title="OPTIs painted with this overlay">
          {count}
        </span>
        <button
          type="button"
          data-testid="overlay-eye"
          title={overlay.visible ? 'Hide this overlay on the map' : 'Show this overlay on the map'}
          onClick={(e) => {
            e.stopPropagation();
            updateOverlay(overlay.id, { visible: !overlay.visible });
          }}
          className={clsx(
            'shrink-0 cursor-pointer rounded-md px-1.5 py-1',
            overlay.visible ? 'text-[#31353b] hover:bg-[#f3f4f5]' : 'text-[#c1c5c9] hover:bg-[#f3f4f5]',
          )}
        >
          {overlay.visible ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7c2 0 3.8.7 5.3 1.6M22 12s-3.5 7-10 7c-2 0-3.8-.7-5.3-1.6M2 2l20 20" />
            </svg>
          )}
        </button>
        <span onClick={(e) => e.stopPropagation()}>
          <ArmedDelete
            armedLabel="Remove"
            armed={armed}
            setArmed={setArmed}
            onConfirm={() => removeOverlay(overlay.id)}
            testid="overlay-delete"
          />
        </span>
      </div>

      {pickerOpen && (
        <>
          <button
            type="button"
            aria-label="Close color picker"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setPickerOpen(false)}
          />
          <div className="absolute top-full left-0 z-20 mt-1 w-[228px] rounded-lg border border-[#e0e2e5] bg-white p-2 shadow-xl">
            <div className="grid grid-cols-6 gap-1.5">
              {OVERLAY_COLORS.map((c) => (
                <Swatch
                  key={c}
                  color={c}
                  active={overlay.color.toUpperCase() === c.toUpperCase()}
                  onPick={() => {
                    updateOverlay(overlay.id, { color: c });
                    setPickerOpen(false);
                  }}
                />
              ))}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-[#6d6e71]">
              <input
                type="color"
                value={overlay.color}
                onChange={(e) => updateOverlay(overlay.id, { color: e.target.value })}
                className="h-6 w-8 cursor-pointer"
              />
              Custom color
            </label>
          </div>
        </>
      )}
    </div>
  );
}

export default function OverlaysPanel({ map }: { map: BayMap }) {
  const tool = useBay((s) => s.tool);
  const { addOverlay } = useBay.getState();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[#e4e6e8] px-4 py-3">
        <h2 className="text-[13px] font-black tracking-[0.08em] text-[#15181d] uppercase">Overlays</h2>
        <Button kind="primary" onClick={() => addOverlay()} testid="add-overlay">
          + New overlay
        </Button>
      </div>
      <div className="abs-scroll flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {map.overlays.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-[#6d6e71]">
            Overlays are colored washes you paint across OPTIs — one for Christmas, one for grills,
            one for "needs processing"… whatever helps.
            <br />
            <br />
            Create one, then click or drag across bins to paint. The eye hides an overlay without
            losing what's painted.
          </p>
        ) : (
          map.overlays.map((o) => <OverlayRow key={o.id} overlay={o} map={map} />)
        )}
      </div>
      {map.overlays.length > 0 && (
        <div className="border-t border-[#e4e6e8] px-4 py-2.5 text-[12px] text-[#6d6e71]">
          {tool === 'paint'
            ? 'Click or drag across bins to paint. Clicking a painted bin erases it.'
            : 'Switch to Paint (top left) to apply the selected overlay.'}
        </div>
      )}
    </div>
  );
}
