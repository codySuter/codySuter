import { useMemo, useState } from 'react';
import { FIELD_LABELS, NO_COLUMN, buildFloorData, type ColumnMap } from '../model/compass';
import { FIXTURES } from '../model/floorplan';
import { useFloor } from '../store';
import { Button, Modal } from './ui';

export interface PendingImport {
  fileName: string;
  grid: string[][];
  cols: ColumnMap;
}

const CORE_FIELDS = ['sku', 'desc'] as const;
const VALUE_FIELDS = ['qoh', 'cost', 'retail', 'sold'] as const;
const DATE_FIELDS = ['datePhys', 'dateSale', 'dateReceipt'] as const;

function FieldSelect({
  label,
  value,
  headers,
  onChange,
  required,
  testid,
}: {
  label: string;
  value: number;
  headers: string[];
  onChange: (i: number) => void;
  required?: boolean;
  testid?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#31353b]">
      <span>
        {label}
        {required && <span className="text-[#c00026]"> *</span>}
      </span>
      <select
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="afs-input w-[220px] cursor-pointer rounded-md border border-[#d6d9dc] bg-white px-2 py-1 text-[12px]"
      >
        <option value={NO_COLUMN}>— not in this export —</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `(column ${i + 1})`}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ImportDialog({ pending, onClose }: { pending: PendingImport; onClose: () => void }) {
  const { setData, showToast } = useFloor.getState();
  const [cols, setCols] = useState<ColumnMap>(pending.cols);
  const headers = pending.grid[0] ?? [];

  const preview = useMemo(() => buildFloorData(pending.grid, cols, pending.fileName), [pending, cols]);
  const matched = new Set(preview.data.skus.flatMap((s) => s.locs)).size;
  const rowsWithLoc = preview.data.skus.filter((s) => s.locs.length > 0).length;

  const setField = (field: keyof Omit<ColumnMap, 'locs'>, i: number) => setCols((c) => ({ ...c, [field]: i }));
  const toggleLoc = (i: number) =>
    setCols((c) => ({
      ...c,
      locs: c.locs.includes(i) ? c.locs.filter((x) => x !== i) : [...c.locs, i].sort((a, b) => a - b),
    }));

  const canApply = cols.sku >= 0 && cols.locs.length > 0;

  return (
    <Modal title="Import Compass export" onClose={onClose} width={700} testid="import-dialog">
      <div className="text-[13px] text-[#31353b]">
        <div className="mb-3">
          <b>{pending.fileName}</b> · {Math.max(0, pending.grid.length - 1).toLocaleString()} data rows
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <div className="flex flex-col gap-2">
            <FieldSelect label={FIELD_LABELS.sku} value={cols.sku} headers={headers} required onChange={(i) => setField('sku', i)} testid="map-sku" />
            <FieldSelect label={FIELD_LABELS.desc} value={cols.desc} headers={headers} onChange={(i) => setField('desc', i)} />
            {VALUE_FIELDS.map((f) => (
              <FieldSelect key={f} label={FIELD_LABELS[f]} value={cols[f]} headers={headers} onChange={(i) => setField(f, i)} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {DATE_FIELDS.map((f) => (
              <FieldSelect key={f} label={FIELD_LABELS[f]} value={cols[f]} headers={headers} onChange={(i) => setField(f, i)} testid={`map-${f}`} />
            ))}
            <div className="mt-1">
              <div className="mb-1 text-[12px] font-medium">
                Location column(s)<span className="text-[#c00026]"> *</span>
              </div>
              <div className="flex max-h-[110px] flex-wrap gap-1 overflow-y-auto" data-testid="loc-columns">
                {headers.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleLoc(i)}
                    className={
                      cols.locs.includes(i)
                        ? 'cursor-pointer rounded-full bg-[#15181d] px-2 py-0.5 text-[11px] font-bold text-white'
                        : 'cursor-pointer rounded-full border border-[#d6d9dc] bg-white px-2 py-0.5 text-[11px] text-[#6d6e71] hover:border-[#b9bec4]'
                    }
                  >
                    {h || `(column ${i + 1})`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-[#f5f6f7] px-3 py-2 text-[12px] leading-relaxed" data-testid="import-summary">
          <b>{preview.data.skus.length.toLocaleString()}</b> SKUs · <b>{rowsWithLoc.toLocaleString()}</b> place into{' '}
          <b>{matched}</b> of {FIXTURES.length} plan locations
          {preview.data.unlocatedRows > 0 && <> · {preview.data.unlocatedRows.toLocaleString()} rows without a location</>}
          {preview.skippedRows > 0 && <> · {preview.skippedRows.toLocaleString()} rows skipped (no SKU)</>}
          {preview.data.unmatched.length > 0 && (
            <div className="mt-1 text-[#c00026]">
              Codes not on the plan:{' '}
              {preview.data.unmatched
                .slice(0, 12)
                .map((u) => u.code)
                .join(', ')}
              {preview.data.unmatched.length > 12 && ` … +${preview.data.unmatched.length - 12} more`}
            </div>
          )}
        </div>

        {!canApply && (
          <p className="mt-2 text-[12px] font-medium text-[#c00026]">Map the SKU column and at least one location column to continue.</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            disabled={!canApply}
            testid="import-apply"
            onClick={() => {
              setData(preview.data);
              showToast(
                `Imported ${preview.data.skus.length.toLocaleString()} SKUs across ${matched} locations.`,
              );
              onClose();
            }}
          >
            Apply import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
