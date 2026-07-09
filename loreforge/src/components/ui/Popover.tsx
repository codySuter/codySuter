import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  anchor: { x: number; y: number } | DOMRect;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  maxHeight?: number;
  align?: "left" | "right";
  className?: string;
}

/** Fixed-position popover with click-outside + Escape to close. Clamps to viewport. */
export function Popover({ anchor, onClose, children, width, maxHeight, align = "left", className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isRect = anchor instanceof DOMRect || (anchor as DOMRect).width !== undefined;
  const base = isRect
    ? { x: (anchor as DOMRect).left, y: (anchor as DOMRect).bottom + 4, right: (anchor as DOMRect).right }
    : { x: (anchor as { x: number; y: number }).x, y: (anchor as { x: number; y: number }).y, right: (anchor as { x: number; y: number }).x };
  const [pos, setPos] = useState({ left: base.x, top: base.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = align === "right" ? base.right - rect.width : base.x;
    let top = base.y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (left < 8) left = 8;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 290 }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={ref}
        className={`lf-menu ${className ?? ""}`}
        style={{
          position: "fixed",
          left: pos.left,
          top: pos.top,
          width,
          maxHeight: maxHeight ?? Math.min(480, window.innerHeight - 40),
          overflowY: "auto",
          zIndex: 300,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
