import { useRef, useState, type ReactNode } from "react";
import { useOnClickOutside, useEscape } from "../lib/hooks";
import { cn } from "../lib/cn";

interface PopoverProps {
  /** render prop for the trigger; receives a toggle fn and open state */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}

export function Popover({
  trigger,
  children,
  align = "right",
  className,
  panelClassName,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useOnClickOutside(ref, close, open);
  useEscape(close, open);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cn(
            "absolute z-30 mt-1 min-w-[12rem] rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function MenuItem({ icon, children, onClick, danger, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition",
        disabled
          ? "cursor-not-allowed text-slate-600"
          : danger
            ? "text-rose-300 hover:bg-rose-500/10"
            : "text-slate-200 hover:bg-slate-800",
      )}
    >
      {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  );
}
