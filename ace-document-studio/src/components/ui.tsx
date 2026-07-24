import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { api } from '../api';

// Support & feedback, matching Ace Sign Studio: bug reports and feature
// requests emailed to csuter@snydersace.net with a prefilled template.
function SupportButton() {
  const [open, setOpen] = useState(false);
  const send = (kind: 'bug' | 'feature') => {
    setOpen(false);
    api.openSupport(kind);
  };
  return (
    <div className="relative">
      <Btn variant="topbar" data-testid="support-btn" onClick={() => setOpen((o) => !o)}>
        ✉ Support
      </Btn>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[115%] z-50 w-[216px] overflow-hidden rounded-[6px] border border-[#D8DBDE] bg-white py-1 text-[#20242B] shadow-lg">
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-[12.5px] hover:bg-[#F3F4F5]"
              onClick={() => send('bug')}
            >
              Report a bug…
            </button>
            <button
              type="button"
              className="block w-full cursor-pointer px-3 py-2 text-left text-[12.5px] hover:bg-[#F3F4F5]"
              onClick={() => send('feature')}
            >
              Request a feature…
            </button>
            <div className="border-t border-[#EDEEF0] px-3 py-1.5 text-[10.5px] text-[#9AA1A8]">
              Emails csuter@snydersace.net
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AppHeader({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 bg-[#15181D] px-3 text-white">
      {left}
      <div className="flex items-center gap-2 select-none">
        <span className="inline-block h-4 w-4 -skew-x-[8deg] rounded-[2px] bg-[#C8102E]" />
        <span
          className="text-[13px] font-extrabold tracking-[0.09em]"
          style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
        >
          ACE DOCUMENT STUDIO
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SupportButton />
        {right}
      </div>
    </header>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-panel className="border-b border-[#E1E3E6] px-3 py-3">
      <h3
        className="mb-2 text-[11px] font-bold tracking-[0.1em] text-[#6D6E71] uppercase"
        style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Btn({
  variant = 'outline',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'topbar' | 'topbar-primary';
}) {
  return (
    <button
      type="button"
      {...props}
      style={{ fontFamily: "'Barlow Semi Condensed', sans-serif", ...props.style }}
      className={clsx(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[5px] text-[12.5px] font-bold tracking-[0.04em] uppercase transition-colors disabled:cursor-default disabled:opacity-40',
        variant === 'primary' &&
          'bg-[#C8102E] px-3 py-1.5 text-white hover:bg-[#9E0620]',
        variant === 'outline' &&
          'border-[1.5px] border-[#15181D] bg-white px-3 py-[5px] text-[#15181D] hover:bg-[#F3F4F5]',
        variant === 'ghost' && 'px-2 py-1 text-[#4A4F57] hover:bg-[#F0F1F2]',
        variant === 'topbar' &&
          'border border-white/35 px-3 py-1.5 text-white hover:border-white hover:bg-white/10',
        variant === 'topbar-primary' &&
          'bg-[#C8102E] px-3 py-1.5 text-white hover:bg-[#E01234]',
        className,
      )}
    />
  );
}

export function Swatches({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (c: string) => void;
  presets: readonly string[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Accent ${c}`}
          onClick={() => onChange(c)}
          className={clsx(
            'h-6 w-6 cursor-pointer rounded-[5px] border-2',
            value.toLowerCase() === c.toLowerCase()
              ? 'border-[#15181D] ring-2 ring-[#15181D]/20'
              : 'border-white shadow-[0_0_0_1px_#D5D8DB]',
          )}
          style={{ background: c }}
        />
      ))}
      <label
        className="relative ml-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-[5px] border border-dashed border-[#9AA1A8] text-[10px] text-[#6D6E71]"
        title="Custom color"
      >
        +
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-[5px] border-[1.5px] border-[#15181D]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          className={clsx(
            'cursor-pointer px-2.5 py-1 text-[11.5px] font-bold tracking-[0.04em] uppercase',
            value === o.value ? 'bg-[#15181D] text-white' : 'bg-white text-[#15181D] hover:bg-[#F3F4F5]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block text-[11.5px] font-medium text-[#4A4F57]">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-[5px] border border-[#C9CED4] bg-white px-2.5 py-1.5 text-[13px] text-[#20242B] outline-none focus:border-[#C8102E] focus:ring-2 focus:ring-[#C8102E]/15';
