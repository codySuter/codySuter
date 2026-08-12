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
        className="afs-scroll max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-2xl"
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

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-[#e8eaec] px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold tracking-[0.14em] text-[#8a9099] uppercase">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
