import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { TypeIcon } from "@/components/icon";
import type { Visibility } from "@/lib/types";

export function EntryCard({
  href,
  title,
  typeLabel,
  icon,
  visibility,
  isEditor,
}: {
  href: string;
  title: string;
  typeLabel: string;
  icon: string | null;
  visibility: Visibility;
  isEditor: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-primary"
    >
      <span className="text-primary">
        <TypeIcon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="text-xs text-muted">{typeLabel}</span>
      </span>
      {isEditor &&
        (visibility === "players" ? (
          <Eye size={14} className="text-accent" aria-label="Revealed to players" />
        ) : (
          <EyeOff size={14} className="text-muted" aria-label="Hidden from players" />
        ))}
    </Link>
  );
}
