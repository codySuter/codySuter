// Folder accent tokens. Keeping these as a small fixed palette keeps folders
// visually distinct without a color picker, and maps cleanly to Tailwind classes.

export interface FolderColor {
  key: string;
  label: string;
  /** dot / accent color */
  dot: string;
  /** subtle background tint when the folder is active */
  activeBg: string;
  text: string;
}

export const FOLDER_COLORS: FolderColor[] = [
  { key: "slate", label: "Slate", dot: "bg-slate-400", activeBg: "bg-slate-400/10", text: "text-slate-300" },
  { key: "rose", label: "Rose", dot: "bg-rose-400", activeBg: "bg-rose-400/10", text: "text-rose-300" },
  { key: "amber", label: "Amber", dot: "bg-amber-400", activeBg: "bg-amber-400/10", text: "text-amber-300" },
  { key: "emerald", label: "Emerald", dot: "bg-emerald-400", activeBg: "bg-emerald-400/10", text: "text-emerald-300" },
  { key: "sky", label: "Sky", dot: "bg-sky-400", activeBg: "bg-sky-400/10", text: "text-sky-300" },
  { key: "violet", label: "Violet", dot: "bg-violet-400", activeBg: "bg-violet-400/10", text: "text-violet-300" },
  { key: "fuchsia", label: "Fuchsia", dot: "bg-fuchsia-400", activeBg: "bg-fuchsia-400/10", text: "text-fuchsia-300" },
  { key: "lime", label: "Lime", dot: "bg-lime-400", activeBg: "bg-lime-400/10", text: "text-lime-300" },
];

export function folderColor(key: string): FolderColor {
  return FOLDER_COLORS.find((c) => c.key === key) ?? FOLDER_COLORS[0];
}
