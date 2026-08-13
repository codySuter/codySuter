import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { CSV_TEMPLATE, csvToRows } from './model/csv';
import BayMapView from './components/BayMapView';
import BinDetails from './components/BinDetails';
import ImportDialog, { type PendingImport } from './components/ImportDialog';
import OverlaysPanel from './components/OverlaysPanel';
import SettingsDialog from './components/SettingsDialog';
import { Button } from './components/ui';
import { useBay } from './store';

const RELEASE_PAGE = 'https://github.com/codysuter/codysuter/releases/tag/ace-bay-studio-windows';

export default function App() {
  const map = useBay((s) => s.map);
  const area = useBay((s) => s.area);
  const tool = useBay((s) => s.tool);
  const search = useBay((s) => s.search);
  const selectedBinId = useBay((s) => s.selectedBinId);
  const settingsOpen = useBay((s) => s.settingsOpen);
  const toast = useBay((s) => s.toast);
  const activeOverlayId = useBay((s) => s.activeOverlayId);
  const { init, setArea, setTool, setSearch, setSettingsOpen, showToast, restoreMap } = useBay.getState();

  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  const importCsv = useCallback(async () => {
    const picked = await api.pickFile('csv');
    if (!picked.ok) {
      if (!picked.canceled) showToast(`Couldn't read that file. ${picked.error ?? ''}`);
      return;
    }
    const parsed = csvToRows(picked.text ?? '');
    if (parsed.rows.length === 0) {
      showToast('No usable rows — the sheet needs an OPTI number and an item name per row.');
      return;
    }
    setPendingImport({ ...parsed, fileName: picked.name ?? 'contents.csv' });
  }, [showToast]);

  const downloadTemplate = useCallback(async () => {
    const res = await api.saveFile('AceBayStudio-contents-template.csv', CSV_TEMPLATE, 'csv');
    if (res.ok) showToast('Template saved — fill it in and use Import contents.');
  }, [showToast]);

  const backup = useCallback(async () => {
    const { map: current } = useBay.getState();
    if (!current) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await api.saveFile(`AceBayStudio-baymap-${stamp}.json`, JSON.stringify(current, null, 2), 'json');
    if (res.ok) showToast('Bay map backed up.');
  }, [showToast]);

  const restore = useCallback(async () => {
    const picked = await api.pickFile('json');
    if (!picked.ok) return;
    if (!window.confirm('Restoring replaces the current bay map (labels, overlays, contents). Continue?')) return;
    try {
      if (restoreMap(JSON.parse(picked.text ?? ''))) showToast('Bay map restored.');
      else showToast("That file doesn't look like an Ace Bay Studio backup.");
    } catch {
      showToast("That file doesn't look like an Ace Bay Studio backup.");
    }
  }, [restoreMap, showToast]);

  useEffect(() => {
    const offMenu = api.onMenu((cmd) => {
      if (cmd === 'import-csv') void importCsv();
      if (cmd === 'csv-template') void downloadTemplate();
      if (cmd === 'backup') void backup();
      if (cmd === 'restore') void restore();
    });
    const offUpdate = api.onUpdate((version) => setUpdateVersion(version));
    return () => {
      offMenu();
      offUpdate();
    };
  }, [importCsv, downloadTemplate, backup, restore]);

  if (!map) {
    return (
      <div className="flex h-full items-center justify-center text-[14px] text-[#6d6e71]">
        Loading the bay map…
      </div>
    );
  }

  let total = 0;
  let labeled = 0;
  const tally = (bin: { label: string }) => {
    total++;
    if (bin.label.trim() !== '') labeled++;
  };
  if (area === 'floor') {
    map.floor.forEach(tally);
  } else {
    for (const aisle of map.aisles)
      for (const bank of aisle.banks) for (const row of bank.shelves) row.forEach(tally);
  }
  const activeOverlay = map.overlays.find((o) => o.id === activeOverlayId);

  return (
    <div className="flex h-full flex-col">
      {/* brand header */}
      <header className="flex items-center justify-between bg-gradient-to-r from-[#D40029] via-[#C00026] to-[#9E0620] px-4 py-2 text-white">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-black tracking-[0.06em] uppercase">Ace Bay Studio</h1>
          <span className="text-[12px] font-medium text-white/85">Snyder's Ace Hardware — back room</span>
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
          <span className="text-[12px] font-bold text-white/90" data-testid="labeled-count">
            {labeled} / {total} {area === 'floor' ? 'locations' : 'OPTIs'} labeled
          </span>
        </div>
      </header>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#dcdee1] bg-white px-4 py-2">
        <div className="inline-flex overflow-hidden rounded-md border border-[#d6d9dc]">
          <button
            type="button"
            data-testid="area-bays"
            onClick={() => setArea('bays')}
            className={clsx(
              'cursor-pointer px-3 py-1.5 text-[13px] font-bold',
              area === 'bays' ? 'bg-[#D40029] text-white' : 'bg-white text-[#31353b] hover:bg-[#f5f6f7]',
            )}
          >
            Back room
          </button>
          <button
            type="button"
            data-testid="area-floor"
            onClick={() => setArea('floor')}
            className={clsx(
              'cursor-pointer border-l border-[#d6d9dc] px-3 py-1.5 text-[13px] font-bold',
              area === 'floor' ? 'bg-[#D40029] text-white' : 'bg-white text-[#31353b] hover:bg-[#f5f6f7]',
            )}
          >
            Sales floor
          </button>
        </div>

        <div className="inline-flex overflow-hidden rounded-md border border-[#d6d9dc]">
          <button
            type="button"
            data-testid="tool-select"
            onClick={() => setTool('select')}
            className={clsx(
              'cursor-pointer px-3 py-1.5 text-[13px] font-bold',
              tool === 'select' ? 'bg-[#15181d] text-white' : 'bg-white text-[#31353b] hover:bg-[#f5f6f7]',
            )}
          >
            Select
          </button>
          <button
            type="button"
            data-testid="tool-paint"
            onClick={() => setTool('paint')}
            className={clsx(
              'flex cursor-pointer items-center gap-1.5 border-l border-[#d6d9dc] px-3 py-1.5 text-[13px] font-bold',
              tool === 'paint' ? 'bg-[#15181d] text-white' : 'bg-white text-[#31353b] hover:bg-[#f5f6f7]',
            )}
          >
            Paint
            {activeOverlay && (
              <span
                className="h-3.5 w-3.5 rounded-[4px] border border-white/40"
                style={{ backgroundColor: activeOverlay.color }}
              />
            )}
          </button>
        </div>

        <input
          data-testid="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find an OPTI # or item…"
          className="abs-input w-[230px] rounded-md border border-[#d6d9dc] px-2.5 py-1.5 text-[13px] text-[#31353b] placeholder:text-[#b9bec5]"
        />
        {search.trim() !== '' && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="cursor-pointer text-[12px] font-medium text-[#6d6e71] hover:text-[#15181d]"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={() => void importCsv()} testid="import-csv">
            Import contents (CSV)
          </Button>
          <Button onClick={() => void downloadTemplate()} title="A ready-to-fill spreadsheet: opti, item, qty, sku, note">
            CSV template
          </Button>
          <Button onClick={() => void backup()} testid="backup">
            Back up
          </Button>
          <Button onClick={() => void restore()}>Restore</Button>
          <Button onClick={() => setSettingsOpen(true)} testid="open-settings">
            Layout
          </Button>
        </div>
      </div>

      {/* map + side panel */}
      <div className="flex min-h-0 flex-1">
        <main className="abs-scroll min-w-0 flex-1 overflow-y-auto p-4">
          <BayMapView map={map} />
        </main>
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-[#dcdee1] bg-white">
          {selectedBinId ? <BinDetails map={map} binId={selectedBinId} /> : <OverlaysPanel map={map} />}
        </aside>
      </div>

      {toast && (
        <div
          data-testid="toast"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#15181d] px-4 py-2 text-[13px] font-medium text-white shadow-xl"
        >
          {toast}
        </div>
      )}

      {settingsOpen && <SettingsDialog map={map} />}
      {pendingImport && <ImportDialog map={map} pending={pendingImport} onClose={() => setPendingImport(null)} />}
    </div>
  );
}
