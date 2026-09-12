import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findMatches } from '../model/find';
import { useStore } from '../store';
import { Btn, inputCls } from './ui';

// Find & replace across every text slot in the open document. Matching is
// case-insensitive; replacing only ever touches text (never markup).
export function FindBar({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.current);
  const select = useStore((s) => s.select);
  const runReplaceOne = useStore((s) => s.runReplaceOne);
  const runReplaceAll = useStore((s) => s.runReplaceAll);
  const setStatus = useStore((s) => s.setStatus);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [active, setActive] = useState(0);
  const findRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    findRef.current?.focus();
  }, []);

  const matches = useMemo(
    () => (doc && query.trim() ? findMatches(doc, query.trim()) : []),
    [doc, query],
  );
  const clamped = matches.length === 0 ? 0 : Math.min(active, matches.length - 1);

  // Walking matches highlights the owning block and scrolls it into view.
  useEffect(() => {
    const m = matches[clamped];
    if (!m) return;
    select(m.blockId);
    const el = m.blockId
      ? document.querySelector(`[data-block="${m.blockId}"]`)
      : document.querySelector('[data-testid="doc-header-item"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [clamped, matches, select]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    setActive((clamped + delta + matches.length) % matches.length);
  };

  const replaceOne = () => {
    const q = query.trim();
    const m = matches[clamped];
    if (!q || !m) return;
    if (!runReplaceOne(m, q, replacement)) {
      setStatus('That match crosses bold/highlight formatting — edit it by hand.');
      step(1);
    }
  };

  const replaceEverything = () => {
    const q = query.trim();
    if (!q) return;
    const n = runReplaceAll(q, replacement);
    setStatus(`Replaced ${n} occurrence${n === 1 ? '' : 's'}.`);
  };

  return (
    <div
      data-testid="find-bar"
      className="flex h-11 shrink-0 items-center gap-2 border-b border-[#D8DBDE] bg-white px-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && e.target === findRef.current) step(e.shiftKey ? -1 : 1);
      }}
    >
      <input
        ref={findRef}
        data-testid="find-input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        placeholder="Find…"
        className={`${inputCls} max-w-[220px]`}
      />
      <span
        data-testid="find-count"
        className="min-w-[64px] text-center text-[11.5px] text-[#6D6E71] tabular-nums"
      >
        {query.trim() ? (matches.length === 0 ? 'No matches' : `${clamped + 1} of ${matches.length}`) : ''}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        onClick={() => step(-1)}
        disabled={matches.length === 0}
        className="cursor-pointer rounded p-1 text-[#4A4F57] hover:bg-[#F0F1F2] disabled:cursor-default disabled:opacity-30"
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        aria-label="Next match"
        onClick={() => step(1)}
        disabled={matches.length === 0}
        className="cursor-pointer rounded p-1 text-[#4A4F57] hover:bg-[#F0F1F2] disabled:cursor-default disabled:opacity-30"
      >
        <ChevronDown size={15} />
      </button>
      <div className="mx-1 h-5 w-px bg-[#E1E3E6]" />
      <input
        data-testid="replace-input"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        placeholder="Replace with…"
        className={`${inputCls} max-w-[220px]`}
      />
      <Btn onClick={replaceOne} disabled={matches.length === 0} data-testid="replace-one">
        Replace
      </Btn>
      <Btn onClick={replaceEverything} disabled={matches.length === 0} data-testid="replace-all">
        All
      </Btn>
      <button
        type="button"
        aria-label="Close find"
        onClick={onClose}
        className="ml-auto cursor-pointer rounded p-1.5 text-[#6D6E71] hover:bg-[#F0F1F2] hover:text-[#15181D]"
      >
        <X size={15} />
      </button>
    </div>
  );
}
