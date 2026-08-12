import { useMemo, useState } from 'react';
import type { BayMap } from '../model/types';
import { normalizeLabel } from '../model/layout';
import type { CsvParseResult } from '../model/csv';
import { useBay } from '../store';
import { Button, Modal } from './ui';

export interface PendingImport extends CsvParseResult {
  fileName: string;
}

export default function ImportDialog({
  map,
  pending,
  onClose,
}: {
  map: BayMap;
  pending: PendingImport;
  onClose: () => void;
}) {
  const { importContents, showToast } = useBay.getState();
  const [mode, setMode] = useState<'replace' | 'append'>('replace');

  // Dry run: which OPTI labels on the sheet exist on the map?
  const plan = useMemo(() => {
    const known = new Set<string>();
    for (const aisle of map.aisles)
      for (const bank of aisle.banks)
        for (const row of bank.shelves)
          for (const bin of row) {
            const key = normalizeLabel(bin.label);
            if (key) known.add(key);
          }
    const matchedLabels = new Set<string>();
    const unmatched = new Set<string>();
    let matchedRows = 0;
    for (const row of pending.rows) {
      const key = normalizeLabel(row.optiLabel);
      if (known.has(key)) {
        matchedLabels.add(key);
        matchedRows++;
      } else {
        unmatched.add(row.optiLabel.trim());
      }
    }
    return { matchedRows, matchedLabels: [...matchedLabels], unmatched: [...unmatched] };
  }, [map, pending]);

  const apply = () => {
    const summary = importContents(pending.rows, mode, pending.skipped);
    showToast(
      `Imported ${summary.itemsAdded} item${summary.itemsAdded === 1 ? '' : 's'} into ${summary.binsMatched} OPTI${summary.binsMatched === 1 ? '' : 's'}.`,
    );
    onClose();
  };

  return (
    <Modal title="Import OPTI contents" onClose={onClose} width={560} testid="import-dialog">
      <p className="text-[13px] text-[#6d6e71]">
        <b className="text-[#31353b]">{pending.fileName}</b> — {pending.rows.length} row
        {pending.rows.length === 1 ? '' : 's'}
        {pending.skipped > 0 ? ` (${pending.skipped} skipped: missing OPTI number or item name)` : ''}.
      </p>

      <div className="mt-3 rounded-lg bg-[#f7f8f9] px-3 py-2.5 text-[13px] text-[#31353b]">
        <div>
          <b>{plan.matchedRows}</b> row{plan.matchedRows === 1 ? '' : 's'} match{' '}
          <b>{plan.matchedLabels.length}</b> labeled OPTI{plan.matchedLabels.length === 1 ? '' : 's'} on the map.
        </div>
        {plan.unmatched.length > 0 && (
          <div className="mt-1.5 text-[#c00026]">
            No OPTI on the map is labeled: {plan.unmatched.slice(0, 12).join(', ')}
            {plan.unmatched.length > 12 ? ` … +${plan.unmatched.length - 12} more` : ''}. Those rows
            are skipped — label the bins first (Select mode → click a bin), then re-import.
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-[13px] text-[#31353b]">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-[#D40029]" />
          <b>Replace</b>&nbsp;each matched OPTI's contents with the sheet (re-import friendly)
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
