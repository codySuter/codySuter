import { useState } from 'react';
import type { Aisle, BayMap } from '../model/types';
import { resizeLosesData } from '../model/layout';
import { useBay } from '../store';
import { ArmedDelete, Button, Modal } from './ui';

function Stepper({
  value,
  min,
  max,
  onChange,
  testid,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testid?: string;
}) {
  return (
    <span className="inline-flex items-center rounded-md border border-[#d6d9dc]" data-testid={testid}>
      <button
        type="button"
        onClick={() => value > min && onChange(value - 1)}
        className="cursor-pointer px-2 py-0.5 text-[14px] font-bold text-[#31353b] hover:bg-[#f3f4f5] disabled:opacity-30"
        disabled={value <= min}
      >
        −
      </button>
      <span className="min-w-[26px] border-x border-[#e4e6e8] px-1 text-center text-[13px] font-bold text-[#15181d]">
        {value}
      </span>
      <button
        type="button"
        onClick={() => value < max && onChange(value + 1)}
        className="cursor-pointer px-2 py-0.5 text-[14px] font-bold text-[#31353b] hover:bg-[#f3f4f5] disabled:opacity-30"
        disabled={value >= max}
      >
        +
      </button>
    </span>
  );
}

function AisleRow({ aisle }: { aisle: Aisle }) {
  const { renameAisle, resizeAisleTo, removeAisle } = useBay.getState();
  const [armed, setArmed] = useState(false);
  const shelves = aisle.banks[0]?.shelves.length ?? 0;
  const perShelf = aisle.banks[0]?.shelves[0]?.length ?? 0;

  const tryResize = (nextShelves: number, nextPerShelf: number) => {
    if (
      (nextShelves < shelves || nextPerShelf < perShelf) &&
      resizeLosesData(aisle, nextShelves, nextPerShelf) &&
      !window.confirm(
        'Shrinking this aisle drops the outermost bins — some of them have labels, overlays or contents. Remove them anyway?',
      )
    ) {
      return;
    }
    resizeAisleTo(aisle.id, nextShelves, nextPerShelf);
  };

  return (
    <div data-testid="settings-aisle" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[#e4e6e8] px-3 py-2">
      <input
        value={aisle.name}
        onChange={(e) => renameAisle(aisle.id, e.target.value)}
        className="abs-input w-[150px] rounded-md border border-[#d6d9dc] px-2 py-1 text-[13px] font-bold text-[#15181d]"
      />
      <label className="flex items-center gap-2 text-[12px] text-[#6d6e71]">
        Shelves high
        <Stepper value={shelves} min={1} max={8} onChange={(v) => tryResize(v, perShelf)} testid="stepper-shelves" />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-[#6d6e71]">
        OPTIs per shelf
        <Stepper value={perShelf} min={1} max={24} onChange={(v) => tryResize(shelves, v)} testid="stepper-pershelf" />
      </label>
      <span className="text-[12px] text-[#9aa1a8]">
        = {shelves * perShelf * aisle.banks.length} OPTIs (both sides)
      </span>
      <span className="ml-auto">
        <ArmedDelete
          armedLabel="Remove aisle"
          armed={armed}
          setArmed={setArmed}
          onConfirm={() => removeAisle(aisle.id)}
          testid="aisle-delete"
        />
      </span>
    </div>
  );
}

export default function SettingsDialog({ map }: { map: BayMap }) {
  const { setSettingsOpen, addAisle, resetMap } = useBay.getState();
  return (
    <Modal title="Bay layout" onClose={() => setSettingsOpen(false)} width={640} testid="settings-dialog">
      <p className="mb-3 text-[13px] leading-relaxed text-[#6d6e71]">
        Every aisle has racking on both sides of the walkway; the sizes below apply to each side.
        Growing an aisle adds empty bins. Shrinking drops the outermost bins.
      </p>
      <div className="space-y-2">
        {map.aisles.map((a) => (
          <AisleRow key={a.id} aisle={a} />
        ))}
      </div>
      <div className="mt-3">
        <Button onClick={addAisle} testid="add-aisle">
          + Add aisle
        </Button>
      </div>
      <div className="mt-5 rounded-lg border border-[#f1c1ca] bg-[#fff8f9] px-3 py-2.5">
        <div className="text-[12px] font-bold tracking-wide text-[#c00026] uppercase">Danger zone</div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="text-[12px] text-[#6d6e71]">
            Wipe everything and start over with 4 empty aisles. Back up first (toolbar) if unsure.
          </span>
          <Button
            kind="danger"
            onClick={() => {
              if (window.confirm('Really erase all labels, overlays and contents? This cannot be undone.')) {
                resetMap();
                setSettingsOpen(false);
              }
            }}
          >
            Reset everything
          </Button>
        </div>
      </div>
    </Modal>
  );
}
