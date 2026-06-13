import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:opacity-90 font-medium",
  secondary:
    "bg-surface-2 text-text border border-line hover:bg-surface",
  ghost: "bg-transparent text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-sm rounded-md gap-1.5",
  md: "h-9 px-3.5 text-sm rounded-md gap-2",
  icon: "h-9 w-9 rounded-md justify-center",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center transition-colors disabled:opacity-50 disabled:pointer-events-none select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
