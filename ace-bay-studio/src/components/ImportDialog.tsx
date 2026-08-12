import { useMemo, useState } from 'react';
import type { BayMap } from '../model/types';
import { normalizeLabel } from '../model/layout';
import { parseDateLoose } from '../model/freshness';
import type { CsvParseResult } from '../model/csv';
import { useBay, type ImportScope } from '../store';
import { Button, Modal } from './ui';

export interface PendingImport extends CsvParseResult {
  fileName: string;
}

const SCOPES: { value: ImportScope; label: string; hint: string }[] = [
  { value: 'bays', label: 'Back room OPTIs', hint: 'numbers on the sheet are OPTI numbers' },
  { value: 'floor', label: 'Sales floor', hint: 'numbers are aisle location codes' },
  { value: 'both', label: 'Both', hint: 'only safe when numbers never collide' },
];

export default function ImportDialog({
  map,
  pending,
  onClose,
}: {
  map: BayMap;
  pending: PendingImport;
  onClose: () => void;
}) {
  const area = useBay((s) => s.area);
  const { importContents, showToast } = useBay.getState();
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  // The current tab is almost always what the export was pulled for.
  const [scope, setScope] = useState<ImportScope>(area);

  // Dry run: which location labels on the sheet exist in the scope?
  const plan = useMemo(() => {
    const known = new Set<string>();
    const addBin = (label: string) => {
      const key = normalizeLabel(label);
      if (key) known.add(key);
    };
    if (scope !== 'floor')
      for (const aisle of map.aisles)
        for (const bank of aisle.banks)
          for (const row of bank.shelves) for (const bin of row) addBin(bin.label);
    if (scope !== 'bays') for (const bin of map.floor) addBin(bin.label);

    const matchedLabels = new Set<string>();
    const unmatched = new Set<string>();
    let matchedRows = 0;
    let dated = 0;
    for (const row of pending.rows) {
      if (parseDateLoose(row.item.lastPhysical)) dated++;
      const key = normalizeLabel(row.optiLabel);
      if (known.has(key)) {
        matchedLabels.add(key);
        matchedRows++;
      } else {
        unmatched.add(row.optiLabel.trim());
      }
    }
    return { matchedRows, matchedLabels: [...matchedLabels], unmatched: [...unmatched], dated };
  }, [map, pending, scope]);

  const apply = () => {
    const summary = importContents(pending.rows, mode, scope, pending.skipped);
    const tip =
      plan.dated > 0 && !map.freshness.enabled
        ? ' Tip: turn on "How old is the data?" in Overlays to color locations by it.'
        : '';
    showToast(
      `Imported ${summary.itemsAdded} item${summary.itemsAdded === 1 ? '' : 's'} into ${summary.binsMatched} location${summary.binsMatched === 1 ? '' : 's'}.${tip}`,
    );
    onClose();
  };

  return (
    <Modal title="Import contents" onClose={onClose} width={580} testid="import-dialog">
      <p className="text-[13px] text-[#6d6e71]">
        <b className="text-[#31353b]">{pending.fileName}</b> — {pending.rows.length} row
        {pending.rows.length === 1 ? '' : 's'}
        {pending.skipped > 0 ? ` (${pending.skipped} skipped: missing location or item name)` : ''}
        {plan.dated > 0 ? `, ${plan.dated} with a Date Last Physical` : ''}. Compass/Eagle query
        exports work as-is.
      </p>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-bold tracking-[0.1em] text-[#8a9099] uppercase">Match against</div>
        <div className="flex gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              data-testid={`scope-${s.value}`}
              title={s.hint}
              onClick={() => setScope(s.value)}
              className={
                scope === s.value
                  ? 'cursor-pointer rounded-md bg-[#15181d] px-2.5 py-1 text-[12px] font-bold text-white'
                  : 'cursor-pointer rounded-md border border-[#d6d9dc] bg-white px-2.5 py-1 text-[12px] font-medium text-[#31353b] hover:bg-[#f5f6f7]'
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-[#f7f8f9] px-3 py-2.5 text-[13px] text-[#31353b]">
        <div>
          <b>{plan.matchedRows}</b> row{plan.matchedRows === 1 ? '' : 's'} match{' '}
          <b>{plan.matchedLabels.length}</b> labeled location{plan.matchedLabels.length === 1 ? '' : 's'}.
        </div>
        {plan.unmatched.length > 0 && (
          <div className="mt-1.5 text-[#c00026]">
            No location here is labeled: {plan.unmatched.slice(0, 12).join(', ')}
            {plan.unmatched.length > 12 ? ` … +${plan.unmatched.length - 12} more` : ''}. Those rows
            are skipped — label the bins/aisles first, then re-import.
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-[13px] text-[#31353b]">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-[#D40029]" />
          <b>Replace</b>&nbsp;each matched location's contents with the sheet (re-import friendly)
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} className="accent-[#D40029]" />
          <b>Append</b>&nbsp;to whatever is already on record
        </label>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" onClick={apply} disabled={plan.matchedRows === 0} testid="import-apply">
          Import {plan.matchedRows > 0 ? `${plan.matchedRows} rows` : ''}
        </Button>
      </div>
    </Modal>
  );
}
