import { useMemo, useState } from 'react';
import type { FixtureHeat } from '../model/heat';
import { DAY, heatColor, metricById, thresholdsFor } from '../model/heat';
import { getFixture } from '../model/floorplan';
import type { HeatSettings, SkuRecord } from '../model/types';
import { useFloor } from '../store';

const fmtDate = (ms: number | null) =>
  ms === null ? '—' : new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC' });

export default function FixtureDetails({
  id,
  heat,
  settings,
  skus,
}: {
  id: string;
  heat: FixtureHeat | undefined;
  settings: HeatSettings;
  skus: SkuRecord[];
}) {
  const { select } = useFloor.getState();
  const metric = metricById(settings.metricId);
  const fixture = getFixture(id);
  const [sortKey, setSortKey] = useState<'age' | 'sku' | 'qoh'>('age');

  const dateField = metric.id === 'sale' ? 'dateSale' : metric.id === 'receipt' ? 'dateReceipt' : 'datePhys';
  const dateHeader = metric.id === 'sale' ? 'Last sale' : metric.id === 'receipt' ? 'Last receipt' : 'Last counted';
  const today = Date.now();
  const { lo, hi } = thresholdsFor(metric.kind === 'age' ? metric : metricById('phys'), settings);

  const rows = useMemo(() => {
    const list = [...skus];
    if (sortKey === 'sku') list.sort((a, b) => a.sku.localeCompare(b.sku));
    else if (sortKey === 'qoh') list.sort((a, b) => (b.qoh ?? 0) - (a.qoh ?? 0));
    else list.sort((a, b) => (a[dateField] ?? -Infinity) - (b[dateField] ?? -Infinity));
    return list;
  }, [skus, sortKey, dateField]);

  const dot = (d: number | null) => {
    const t = d === null ? 1 : Math.min(1, Math.max(0, ((today - d) / DAY - lo) / Math.max(1, hi - lo)));
    return heatColor('age', settings.ramp, t);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="fixture-details">
      <div className="flex items-start justify-between gap-2 border-b border-[#e8eaec] px-4 py-3">
        <div>
          <h2 className="text-[17px] font-black tracking-wide text-[#15181d]">{fixture?.label ?? id}</h2>
          <div className="text-[12px] font-medium text-[#6d6e71]" data-testid="details-heat">
            {heat
              ? heat.value === null
                ? `${metric.label}: never`
                : `${metric.label}: ${heat.text}`
              : 'No SKUs in this import'}
            {' · '}
            {skus.length} SKU{skus.length === 1 ? '' : 's'}
            {heat && heat.neverCount > 0 && heat.value !== null ? ` · ${heat.neverCount} never counted` : ''}
          </div>
        </div>
        <button
          type="button"
          data-testid="details-close"
          aria-label="Close"
          onClick={() => select(null)}
          className="cursor-pointer rounded-md px-2 py-0.5 text-[18px] leading-none text-[#6d6e71] hover:bg-[#f3f4f5] hover:text-[#15181d]"
        >
          ×
        </button>
      </div>

      <div className="afs-scroll min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[#6d6e71]">
            The import has nothing stocked at {fixture?.label ?? id}.
          </p>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#e8eaec] text-left text-[10px] tracking-[0.1em] text-[#8a9099] uppercase">
                <th className="cursor-pointer px-2 py-1.5 pl-4" onClick={() => setSortKey('sku')}>
                  SKU {sortKey === 'sku' ? '▾' : ''}
                </th>
                <th className="px-2 py-1.5">Description</th>
                <th className="cursor-pointer px-2 py-1.5 text-right" onClick={() => setSortKey('qoh')}>
                  QOH {sortKey === 'qoh' ? '▾' : ''}
                </th>
                <th className="cursor-pointer px-2 py-1.5 pr-4 text-right" onClick={() => setSortKey('age')}>
                  {dateHeader} {sortKey === 'age' ? '▴' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const d = s[dateField];
                const days = d === null ? null : Math.floor((today - d) / DAY);
                return (
                  <tr key={`${s.sku}-${i}`} data-testid="sku-row" className="border-b border-[#f1f2f3]">
                    <td className="px-2 py-1.5 pl-4 font-mono font-bold whitespace-nowrap text-[#15181d]">{s.sku}</td>
                    <td className="px-2 py-1.5 text-[#31353b]">{s.desc}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap text-[#31353b]">{s.qoh ?? '—'}</td>
                    <td className="px-2 py-1.5 pr-4 text-right whitespace-nowrap text-[#31353b]">
                      <span
                        className="mr-1.5 inline-block h-[8px] w-[8px] rounded-full align-middle"
                        style={{ background: dot(d) }}
                      />
                      {d === null ? 'never' : `${fmtDate(d)} (${days}d)`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
