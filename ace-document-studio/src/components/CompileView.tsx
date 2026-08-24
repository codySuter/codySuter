import { useEffect, useRef, useState } from 'react';
import { FONT_BODY, FONT_DISPLAY, INK, KICKER_GRAY } from '../model/docstyle';
import { plainText } from '../model/sanitize';
import { PRINTABLE_H_PX } from '../model/types';
import { useStore } from '../store';
import { PageView } from './PageView';

const ACCENT = '#C8102E';

// Estimated printed pages for one document wrapper: manual page breaks
// split it into segments, each segment flows across ceil(h / printable)
// pages. Measured in the same renderer that prints, so the geometry is
// the print geometry.
function pagesOf(wrap: HTMLElement): number {
  const breaks = wrap.querySelectorAll('[data-pagebreak]');
  if (breaks.length === 0) return Math.max(1, Math.ceil(wrap.offsetHeight / PRINTABLE_H_PX));
  const top = wrap.getBoundingClientRect().top;
  let pages = 0;
  let prev = 0;
  breaks.forEach((b) => {
    const y = b.getBoundingClientRect().top - top;
    pages += Math.max(1, Math.ceil((y - prev) / PRINTABLE_H_PX));
    prev = y;
  });
  pages += Math.max(1, Math.ceil((wrap.offsetHeight - prev) / PRINTABLE_H_PX));
  return pages;
}

// The #/compile/<ids> route: a cover page, an optional table of contents,
// then each selected document starting on a fresh page. Printed through
// the same engine as single documents; the whole bundle gets continuous
// "PAGE x OF y" footers.
export function CompileView() {
  const route = useStore((s) => s.route);
  const docs = useStore((s) => s.docs);
  const wrapsRef = useRef<(HTMLDivElement | null)[]>([]);
  const tocRef = useRef<HTMLDivElement | null>(null);
  const [starts, setStarts] = useState<number[] | null>(null);
  const signaled = useRef(false);

  const cfg = route.name === 'compile' ? route : null;
  const ordered = cfg
    ? cfg.ids.map((id) => docs.find((d) => d.id === id)).filter((d) => d !== undefined)
    : [];

  useEffect(() => {
    document.body.classList.add('print-mode');
    return () => document.body.classList.remove('print-mode');
  }, []);

  // Pass 1: measure everything, compute each document's starting page.
  useEffect(() => {
    if (!cfg || ordered.length === 0 || starts !== null) return;
    let dead = false;
    void (async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (dead) return;
      const tocPages = cfg.toc
        ? Math.max(1, Math.ceil((tocRef.current?.offsetHeight ?? 1) / PRINTABLE_H_PX))
        : 0;
      let page = 2 + tocPages; // cover is page 1, TOC follows
      const s = ordered.map((_d, k) => {
        const from = page;
        const wrap = wrapsRef.current[k];
        page += wrap ? pagesOf(wrap) : 1;
        return from;
      });
      setStarts(s);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.ids.join(','), ordered.length, starts]);

  // Pass 2: page numbers are in the TOC — hand the layout to the printer.
  useEffect(() => {
    if (starts === null || signaled.current) return;
    signaled.current = true;
    if (cfg) document.title = cfg.title || 'Store Documents';
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (window.aps?.isElectron) {
        window.aps.printReady({ multiPage: true });
      } else {
        const s = document.createElement('style');
        s.textContent = '@page { size: letter; margin: 0.4in }';
        document.head.appendChild(s);
        window.print();
        window.history.back();
      }
    })();
  }, [starts, cfg]);

  if (!cfg) return null;
  if (ordered.length === 0) {
    return <div style={{ padding: 40, fontFamily: FONT_BODY }}>Loading documents…</div>;
  }

  const today = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div style={{ background: '#fff', minHeight: '100vh', width: '7.7in', fontFamily: FONT_BODY }}>
      {/* Cover */}
      <div data-testid="compile-cover" style={{ height: PRINTABLE_H_PX - 2, position: 'relative' }}>
        <div style={{ height: 8, background: ACCENT }} />
        <div style={{ paddingTop: 240 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: KICKER_GRAY,
            }}
          >
            Snyder's Ace Hardware · Media, PA
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              fontSize: 46,
              lineHeight: 1.02,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
              color: INK,
              marginTop: 10,
            }}
          >
            {cfg.title || 'Store Documents'}
          </div>
          <div style={{ height: 3, width: 84, background: ACCENT, marginTop: 16 }} />
          <div style={{ marginTop: 18, fontSize: 13, color: '#4A4F57' }}>
            {ordered.length} document{ordered.length === 1 ? '' : 's'} · Compiled {today}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            borderTop: `1.5px solid ${INK}`,
            paddingTop: 6,
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#6D6E71',
          }}
        >
          Internal reference — current versions live in Ace Document Studio
        </div>
      </div>

      {/* Table of contents */}
      {cfg.toc && (
        <div ref={tocRef} data-testid="compile-toc" style={{ breakBefore: 'page' }}>
          <div style={{ height: 8, background: ACCENT }} />
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              fontSize: 24,
              textTransform: 'uppercase',
              color: INK,
              padding: '14px 0 6px',
              borderBottom: `2px solid ${ACCENT}`,
            }}
          >
            Contents
          </div>
          <div style={{ paddingTop: 10 }}>
            {ordered.map((d, k) => (
              <div
                key={d.id}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
                  {plainText(d.title) || 'Untitled'}
                </span>
                <span style={{ fontSize: 11, color: '#6D6E71' }}>{plainText(d.subtitle)}</span>
                <span
                  style={{ flex: 1, borderBottom: '1.5px dotted #BCBEC0', margin: '0 4px' }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
                  {starts ? starts[k] : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The documents, each on a fresh page */}
      {ordered.map((d, k) => (
        <div
          key={d.id}
          ref={(el) => {
            wrapsRef.current[k] = el;
          }}
          style={{ breakBefore: 'page' }}
        >
          <PageView doc={d} mode="print" />
        </div>
      ))}
    </div>
  );
}
