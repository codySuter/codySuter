import type { AppData } from "../types";

/** Serialize the full dataset and trigger a download as a .json backup file. */
export function downloadBackup(data: AppData): void {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `encounter-board-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse and lightly validate an uploaded backup file. Throws on bad input. */
export async function readBackup(file: File): Promise<AppData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<AppData>;
  if (!parsed || !Array.isArray(parsed.characters) || !Array.isArray(parsed.folders)) {
    throw new Error("That file doesn't look like an Encounter Board backup.");
  }
  return {
    version: parsed.version ?? 1,
    folders: parsed.folders,
    characters: parsed.characters,
    encounter:
      parsed.encounter ?? { active: false, round: 1, turnCharId: null },
  };
}
