import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, b64ToBytes } from './api';
import FixtureDetails from './components/FixtureDetails';
import FloorMapView from './components/FloorMapView';
import ImportDialog, { type PendingImport } from './components/ImportDialog';
import SummaryPanel from './components/SummaryPanel';
import { Button } from './components/ui';
import { detectColumns } from './model/compass';
import { parseCsv } from './model/csv';
import { METRICS, availableFields, computeHeat, metricAvailable, metricById, type FixtureHeat } from './model/heat';
import type { MetricId } from './model/types';
import { sniffFormat, xlsxToGrid } from './model/xlsx';
import { searchHits, useFloor } from './store';
import sampleCsv from '../sample/compass-sample.csv?raw';

const RELEASE_PAGE = 'https://github.com/codysuter/codysuter/releases/tag/ace-floor-studio-windows';

export default function App() {
  const doc = useFloor((s) => s.doc);
  const index = useFloor((s) => s.index);
  const search = useFloor((s) => s.search);
  const selectedId = useFloor((s) => s.selectedId);
  const toast = useFloor((s) => s.toast);
  const { init, setSearch, setSettings, showToast, restoreDoc } = useFloor.getState();

  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const importSeq = useRef(0);

  useEffect(() => {
    void init();
  }, [init]);

  const openImport = useCallback((fileName: string, grid: string[][]) => {
    if (grid.length < 2) {
      useFloor.getState().showToast('That file has no data rows under the header.');
      return;
    }
    const cols = detectColumns(grid[0]);
    setPendingImport({ fileName, grid, cols, seq: ++importSeq.current });
  }, []);

  const importFile = useCallback(async () => {
    const picked = await api.pickFile('import');
    if (!picked.ok) {
      if (!picked.canceled) showToast(`Couldn't read that file. ${picked.error ?? ''}`);
      return;
    }
    try {
      const bytes = b64ToBytes(picked.bytes ?? '');
      const format = sniffFormat(bytes);
      if (format === 'xls') {
        showToast('That is an old-style .xls file — in Compass, export as .xlsx or .csv instead.');
        return;
      }
      const grid =
        format === 'xlsx'
          ? xlsxToGrid(bytes)
          : parseCsv(new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''));
      openImport(picked.name ?? 'compass-export', grid);
    } catch (err) {
      showToast(`Couldn't parse that file. ${err instanceof Error ? err.message : ''}`);
    }
  }, [openImport, showToast]);

  const loadSample = useCallback(() => {
    openImport('compass-sample.csv', parseCsv(sampleCsv));
  }, [openImport]);

  const backup = useCallback(async () => {
    const { doc: current } = useFloor.getState();
    if (!current) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await api.saveFile(`AceFloorStudio-${stamp}.json`, JSON.stringify(current), 'json');
    if (res.ok) showToast('Floor data backed up.');
  }, [showToast]);

  const restore = useCallback(async () => {
    const picked = await api.pickFile('json');
    if (!picked.ok) return;
    if (!window.confirm('Restoring replaces the current import and settings. Continue?')) return;
    try {
      const text = new TextDecoder('utf-8').decode(b64ToBytes(picked.bytes ?? ''));
      if (restoreDoc(JSON.parse(text))) showToast('Floor data restored.');
      else showToast("That file doesn't look like an Ace Floor Studio backup.");
    } catch {
      showToast("That file doesn't look like an Ace Floor Studio backup.");
    }
  }, [restoreDoc, showToast]);

  useEffect(() => {
    const offMenu = api.onMenu((cmd) => {
      if (cmd === 'import') void importFile();
      if (cmd === 'sample') loadSample();
      if (cmd === 'backup') void backup();
      if (cmd === 'restore') void restore();
    });
    const offUpdate = api.onUpdate((version) => setUpdateVersion(version));
    return () => {
      offMenu();
      offUpdate();
    };
  }, [importFile, loadSample, backup, restore]);

  const storedSettings = doc?.settings;
  const data = doc?.data ?? null;

  const present = useMemo(() => availableFields(data), [data]);
  // A stored metric can outlive its column (a new import without it, a
  // restored backup) — fall back to the first metric this data can run.
  const settings = useMemo(() => {
    if (!storedSettings) return storedSettings;
    if (metricAvailable(metricById(storedSettings.metricId), present)) return storedSettings;
    const fallback = METRICS.find((m) => metricAvailable(m, present))?.id ?? 'skuCount';
    return { ...storedSettings, metricId: fallback };
  }, [storedSettings, present]);
  // Recompute "days since" once a minute so a long-open window stays honest.
  const [todayTick, setTodayTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTodayTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const heatRes = useMemo(
    () =>
      settings
        ? computeHeat(index, settings, todayTick)
        : { byFixture: new Map<string, FixtureHeat>(), magTop: 0 },
    [index, settings, todayTick],
  );
  const heat = heatRes.byFixture;
  const hits = useMemo(() => searchHits(index, search), [index, search]);

  if (!doc || !settings) {
    return <div className="flex h-full items-center justify-center text-[14px] text-[#6d6e71]">Loading the floor…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* brand header */}
      <header className="flex items-center justify-between bg-gradient-to-r from-[#D40029] via-[#C00026] to-[#9E0620] px-4 py-2 text-white">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-black tracking-[0.06em] uppercase">Ace Floor Studio</h1>
          <span className="text-[12px] font-medium text-white/85">Snyder's Ace Hardware — sales floor</span>
        </div>
        <div className="flex items-center gap-3">
          {updateVersion && (
            <a
              href={RELEASE_PAGE}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#D40029] hover:bg-white/90"
            >
              Update {updateVersion} available ↗
            </a>
          )}
          <span className="text-[12px] font-bold text-white/90" data-testid="header-status">
            {data ? `${heat.size} locations heat-mapped` : 'No import yet'}
          </span>
        </div>
      </header>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#dcdee1] bg-white px-4 py-2">
        <label className="flex items-center gap-2 text-[13px] font-bold text-[#31353b]">
          Heatmap
          <select
            data-testid="metric-select"
            value={settings.metricId}
            onChange={(e) => setSettings({ metricId: e.target.value as MetricId })}
            className="afs-input cursor-pointer rounded-md border border-[#d6d9dc] bg-white px-2 py-1.5 text-[13px] font-medium"
          >
            {METRICS.map((m) => {
              const ok = metricAvailable(m, present);
              return (
                <option key={m.id} value={m.id} disabled={!ok}>
                  {m.label}
                  {ok ? '' : ' — column not in import'}
                </option>
              );
            })}
          </select>
        </label>

        <input
          data-testid="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a SKU, item, or location…"
          className="afs-input w-[240px] rounded-md border border-[#d6d9dc] px-2.5 py-1.5 text-[13px] text-[#31353b] placeholder:text-[#b9bec5]"
        />
        {search.trim() !== '' && (
          <span className="text-[12px] font-medium text-[#6d6e71]" data-testid="search-count">
            {hits?.size ?? 0} location{(hits?.size ?? 0) === 1 ? '' : 's'}
            <button
              type="button"
              onClick={() => setSearch('')}
              className="ml-2 cursor-pointer font-medium text-[#6d6e71] underline hover:text-[#15181d]"
            >
              Clear
            </button>
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button kind="primary" onClick={() => void importFile()} testid="import-file">
            Import Compass export…
          </Button>
          <Button onClick={() => void backup()} testid="backup">
            Back up
          </Button>
          <Button onClick={() => void restore()}>Restore</Button>
        </div>
      </div>

      {/* map + side panel */}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <FloorMapView heat={heat} settings={settings} hits={hits} />
        </main>
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-[#dcdee1] bg-white">
          {selectedId ? (
            <FixtureDetails id={selectedId} heat={heat.get(selectedId)} settings={settings} skus={index.get(selectedId) ?? []} />
          ) : (
            <SummaryPanel heat={heat} magTop={heatRes.magTop} settings={settings} data={data} onImport={() => void importFile()} onLoadSample={loadSample} />
          )}
        </aside>
      </div>

      {/* first-run hint over the map */}
      {!data && (
        <div className="pointer-events-none fixed inset-x-0 top-[45%] flex justify-center">
          <div className="pointer-events-auto rounded-xl border border-[#e0e2e5] bg-white px-6 py-5 text-center shadow-xl">
            <div className="text-[15px] font-black text-[#15181d]">The floor is waiting on numbers.</div>
            <p className="mt-1 mb-3 max-w-[420px] text-[13px] text-[#6d6e71]">
              Import a Compass export (CSV or XLSX) with SKU, location, and date-last-physical columns — or load the
              sample to see how the heatmap reads.
            </p>
            <div className="flex justify-center gap-2">
              <Button kind="primary" onClick={() => void importFile()} testid="import-hero">
                Import Compass export…
              </Button>
              <Button onClick={loadSample} testid="sample-hero">
                Load sample data
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          data-testid="toast"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#15181d] px-4 py-2 text-[13px] font-medium text-white shadow-xl"
        >
          {toast}
        </div>
      )}

      {pendingImport && <ImportDialog key={pendingImport.seq} pending={pendingImport} onClose={() => setPendingImport(null)} />}
    </div>
  );
}
