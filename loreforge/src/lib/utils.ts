import { clsx, type ClassValue } from "clsx";

export const cn = (...args: ClassValue[]) => clsx(...args);

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args: Args) => {
    if (timer) clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
  };
  return wrapped as typeof wrapped & { flush: (...args: Args) => void; cancel: () => void };
}

/** Deep-clean a BlockNote document for Convex: undefined -> null in arrays, drop undefined props. */
export function sanitizeDoc<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc)) as T;
}

/** Restore `columnWidths: null` entries to undefined so BlockNote accepts stored tables. */
export function reviveDoc(doc: unknown): unknown {
  if (!Array.isArray(doc)) return doc;
  const visit = (blocks: unknown[]): unknown[] =>
    blocks.map((raw) => {
      if (typeof raw !== "object" || raw === null) return raw;
      const block = { ...(raw as Record<string, unknown>) };
      const content = block.content as Record<string, unknown> | unknown[] | undefined;
      if (
        content &&
        !Array.isArray(content) &&
        Array.isArray((content as Record<string, unknown>).columnWidths)
      ) {
        block.content = {
          ...content,
          columnWidths: ((content as Record<string, unknown>).columnWidths as unknown[]).map(
            (w) => (w === null ? undefined : w),
          ),
        };
      }
      if (Array.isArray(block.children)) block.children = visit(block.children);
      return block;
    });
  return visit(doc);
}

/** Midpoint sort order for inserting between two siblings. */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

export function formatDate(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export const modKey = isMac ? "⌘" : "Ctrl+";

let uidCounter = 0;
export const localId = () =>
  `lf${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
