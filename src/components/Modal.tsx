import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useEscape } from "../lib/hooks";
import { cn } from "../lib/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** footer actions row */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
};

export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onClick={(e) => {
        // Only close on a genuine click on the backdrop itself — not on a
        // drag/selection that happens to end here, and not on inner clicks.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "my-auto w-full rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl shadow-black/50",
          SIZE[size],
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
