import { clsx } from 'clsx';
import { useState } from 'react';
import type { FixtureHeat } from '../model/heat';
import {
  NEVER_FILL,
  NO_DATA_FILL,
  formatValue,
  metricById,
  rampGradient,
  thresholdsFor,
} from '../model/heat';
import { FIXTURES, getFixture } from '../model/floorplan';
import type { FloorData, HeatSettings } from '../model/types';
import { useFloor } from '../store';
import { Button, Section } from './ui';

function NumberInput({
  value,
  onCommit,
  testid,
  suffix,
}: {
  value: number;
  onCommit: (n: number) => void;
  testid?: string;
  suffix: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        data-testid={testid}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          // A cleared field reverts — Number('') is 0, not an entry.
          if (text !== null && text.trim() !== '' && !Number.isNaN(n) && n >= 0) onCommit(Math.round(n));
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        inputMode="numeric"
        className="afs-input w-[64px] rounded-md border border-[#d6d9dc] px-2 py-1 text-right text-[13px] text-[#31353b]"
      />
      <span className="text-[12px] text-[#6d6e71]">{suffix}</span>
    </span>
  );
}

export default function SummaryPanel({
  heat,
  magTop,
  settings,
  data,
  onImport,
  onLoadSample,
}: {
  heat: Map<string, FixtureHeat>;
  magTop: number;
  settings: HeatSettings;
  data: FloorData | null;
  onImport: () => void;
  onLoadSample: () => void;
}) {
  const { setSettings, setThreshold, select } = useFloor.getState();
  const metric = metricById(settings.metricId);
  const { lo, hi } = thresholdsFor(metric, settings);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const covered = heat.size;
  // Null values rank worst on age metrics (never counted); on pct
  // metrics they mean "no usable values" and stay out of the list.
  const worst = [...heat.entries()]
    .filter(([id, h]) => getFixture(id) && (metric.kind === 'age' || h.value !== null))
    .sort((a, b) => {
      const av = a[1].value === null ? Infinity : a[1].t;
      const bv = b[1].value === null ? Infinity : b[1].t;
      return bv - av || (b[1].value ?? 0) - (a[1].value ?? 0);
    })
    .slice(0, 15);

  return (
    <div className="afs-scroll flex-1 overflow-y-auto">
      <Section title="Heatmap scale">
        <p className="mb-2 text-[12px] leading-snug text-[#6d6e71]">{metric.blurb}</p>
        <div
          data-testid="legend-bar"
          className="h-[14px] rounded-full border border-[#d9dbde]"
          style={{ background: rampGradient(metric.kind, settings.ramp) }}
        />
        <div className="mt-1 flex justify-between text-[11px] font-medium text-[#6d6e71]">
          {metric.kind === 'age' && (
            <>
              <span>≤ {lo} days</span>
              <span>≥ {hi} days</span>
            </>
          )}
          {metric.kind === 'pct' && (
            <>
              <span>{lo}%</span>
              <span>≥ {hi}%</span>
            </>
          )}
          {metric.kind === 'magnitude' && (
            <>
              <span>0</span>
              <span>{formatValue(metric, magTop)}+ (95th pct)</span>
            </>
          )}
        </div>

        {metric.kind === 'age' && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="text-[12px] font-medium text-[#31353b]">Green ≤</label>
              <NumberInput value={lo} suffix="d" testid="threshold-lo" onCommit={(n) => setThreshold(metric.id, n, Math.max(n + 1, hi))} />
              <label className="text-[12px] font-medium text-[#31353b]">Red ≥</label>
              <NumberInput
                value={hi}
                suffix="d"
                testid="threshold-hi"
                onCommit={(n) => {
                  const h = Math.max(1, n);
                  setThreshold(metric.id, Math.min(lo, h - 1), h);
                }}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] font-medium text-[#31353b]">Bay shows</span>
              <div className="inline-flex overflow-hidden rounded-md border border-[#d6d9dc]">
                {(['oldest', 'average', 'newest'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`age-mode-${m}`}
                    onClick={() => setSettings({ ageMode: m })}
                    className={clsx(
                      'cursor-pointer px-2 py-1 text-[12px] font-bold capitalize',
                      settings.ageMode === m ? 'bg-[#15181d] text-white' : 'bg-white text-[#31353b] hover:bg-[#f5f6f7]',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-[#6d6e71]">count</span>
            </div>
          </>
        )}
        {metric.kind === 'pct' && (
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[12px] font-medium text-[#31353b]">Full red at ≥</label>
            <NumberInput value={hi} suffix="%" testid="threshold-hi" onCommit={(n) => setThreshold(metric.id, 0, Math.max(1, n))} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
          {metric.kind === 'age' && (
            <span className="inline-flex items-center gap-1.5 font-medium text-[#31353b]">
              <span className="inline-block h-[12px] w-[12px] rounded-[3px]" style={{ background: NEVER_FILL }} />
              never counted
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 font-medium text-[#31353b]">
            <span className="inline-block h-[12px] w-[12px] rounded-[3px] border border-[#c9ccd1]" style={{ background: NO_DATA_FILL }} />
            no SKUs in import
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[#31353b]">
            <input
              type="checkbox"
              data-testid="ramp-cvd"
              checked={settings.ramp === 'cvd'}
              onChange={(e) => setSettings({ ramp: e.target.checked ? 'cvd' : 'classic' })}
            />
            Colorblind-friendly colors (blue → red)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[#31353b]">
            <input
              type="checkbox"
              data-testid="show-values"
              checked={settings.showValues}
              onChange={(e) => setSettings({ showValues: e.target.checked })}
            />
            Print values on the map
          </label>
        </div>
      </Section>

      <Section title="This import">
        {data ? (
          <div className="text-[12px] leading-relaxed text-[#31353b]">
            <div className="font-bold">{data.fileName}</div>
            <div className="text-[#6d6e71]">
              {new Date(data.importedAt).toLocaleDateString()} · {data.rowCount.toLocaleString()} rows ·{' '}
              {data.skus.length.toLocaleString()} SKUs
            </div>
            <div className="mt-1" data-testid="coverage">
              <b>{covered}</b> of {FIXTURES.length} locations covered
            </div>
            {data.unlocatedRows > 0 && <div className="text-[#6d6e71]">{data.unlocatedRows.toLocaleString()} rows had no location</div>}
            {data.unmatched.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  data-testid="unmatched-toggle"
                  onClick={() => setShowUnmatched(!showUnmatched)}
                  className="cursor-pointer font-bold text-[#c00026] hover:underline"
                >
                  {data.unmatched.length} location code{data.unmatched.length === 1 ? '' : 's'} not on the plan{' '}
                  {showUnmatched ? '▾' : '▸'}
                </button>
                {showUnmatched && (
                  <div data-testid="unmatched-list" className="mt-1 flex max-h-[130px] flex-wrap gap-1 overflow-y-auto">
                    {data.unmatched.map((u) => (
                      <span key={u.code} className="rounded bg-[#f3f4f5] px-1.5 py-0.5 font-mono text-[11px] text-[#31353b]">
                        {u.code} ×{u.rows}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-2">
              <Button onClick={onImport} testid="import-again">
                Import a newer export…
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-[#6d6e71]">
            No Compass data yet.
            <div className="mt-2 flex gap-2">
              <Button kind="primary" onClick={onImport} testid="import-empty">
                Import Compass export…
              </Button>
              <Button onClick={onLoadSample} testid="load-sample">
                Load sample
              </Button>
            </div>
          </div>
        )}
      </Section>

      {data && worst.length > 0 && (
        <Section title={`Most urgent — ${metric.label}`}>
          <ol className="flex flex-col">
            {worst.map(([id, h]) => (
              <li key={id}>
                <button
                  type="button"
                  data-testid="worst-row"
                  onClick={() => select(id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-[#f5f6f7]"
                >
                  <span className="font-bold text-[#15181d]">{getFixture(id)?.label ?? id}</span>
                  <span className="font-medium text-[#6d6e71]">
                    {h.value === null ? 'never counted' : h.text}
                    {' · '}
                    {h.skuCount} SKU{h.skuCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
