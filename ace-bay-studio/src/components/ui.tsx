import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function Button({
  children,
  onClick,
  kind = 'ghost',
  className,
  title,
  testid,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  className?: string;
  title?: string;
  testid?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-40',
        kind === 'primary' && 'bg-[#D40029] text-white hover:bg-[#b30023]',
        kind === 'ghost' && 'border border-[#d6d9dc] bg-white text-[#31353b] hover:border-[#b9bec4] hover:bg-[#f5f6f7]',
        kind === 'danger' && 'border border-[#f1c1ca] bg-white text-[#c00026] hover:bg-[#fdecee]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 560,
  testid,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
  testid?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#15181d]/45 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid={testid}
        className="abs-scroll max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-2xl"
        style={{ width, maxWidth: '100%' }}
      >
        <div className="flex items-center justify-between border-b border-[#e4e6e8] px-5 py-3">
          <h2 className="text-[15px] font-black tracking-wide text-[#15181d] uppercase">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="cursor-pointer rounded-md px-2 py-0.5 text-[18px] leading-none text-[#6d6e71] hover:bg-[#f3f4f5] hover:text-[#15181d]"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Two-tap inline delete: first tap arms it, second confirms. */
export function ArmedDelete({
  armedLabel,
  onConfirm,
  armed,
  setArmed,
  testid,
}: {
  armedLabel: string;
  onConfirm: () => void;
  armed: boolean;
  setArmed: (v: boolean) => void;
  testid?: string;
}) {
  return armed ? (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        data-testid={testid ? `${testid}-confirm` : undefined}
        onClick={onConfirm}
        className="cursor-pointer rounded-md bg-[#D40029] px-2 py-1 text-[12px] font-bold text-white hover:bg-[#b30023]"
      >
        {armedLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="cursor-pointer rounded-md border border-[#d6d9dc] px-2 py-1 text-[12px] text-[#31353b] hover:bg-[#f5f6f7]"
      >
        Keep
      </button>
    </span>
  ) : (
    <button
      type="button"
      data-testid={testid}
      title="Delete"
      onClick={() => setArmed(true)}
      className="cursor-pointer rounded-md px-1.5 py-1 text-[#9aa1a8] hover:bg-[#fdecee] hover:text-[#c00026]"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </svg>
    </button>
  );
}
