import {
  User,
  Skull,
  MapPin,
  Store,
  Sparkles,
  Package,
  NotebookPen,
  Shield,
  Map,
  FileText,
  type LucideProps,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  User,
  Skull,
  MapPin,
  Store,
  Sparkles,
  Package,
  NotebookPen,
  Shield,
  Map,
};

/** Render a lucide icon by the name stored on an entry_type (falls back to a doc). */
export function TypeIcon({
  name,
  size = 16,
  className,
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const Comp = (name && ICONS[name]) || FileText;
  return <Comp size={size} className={className} />;
}
