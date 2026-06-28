import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Download,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Swords,
  Trash2,
  Upload,
} from "lucide-react";
import type { Character, Folder } from "../types";
import { useStore } from "../store/useStore";
import { TEMPLATES } from "../lib/templates";
import { FOLDER_COLORS, folderColor } from "../lib/theme";
import { downloadBackup, readBackup } from "../lib/backup";
import { cn } from "../lib/cn";
import { Popover, MenuItem } from "./Popover";

interface SidebarProps {
  onEdit: (id: string) => void;
  onImport: () => void;
  onNewFromTemplate: (templateKey: string) => void;
}

export function Sidebar({ onEdit, onImport, onNewFromTemplate }: SidebarProps) {
  const folders = useStore((s) => s.folders);
  const characters = useStore((s) => s.characters);
  const encounter = useStore((s) => s.encounter);
  const createFolder = useStore((s) => s.createFolder);
  const replaceAll = useStore((s) => s.replaceAll);

  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? characters.filter((c) => c.name.toLowerCase().includes(q)) : characters),
    [characters, q],
  );

  const unfiled = filtered.filter((c) => c.folderId == null);

  async function handleImportFile(file: File) {
    try {
      const data = await readBackup(file);
      if (
        confirm(
          `Import ${data.characters.length} characters and ${data.folders.length} folders? This replaces your current data.`,
        )
      ) {
        await replaceAll(data);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950/70">
      {/* brand */}
      <div className="flex items-center gap-2 px-4 py-3.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-rose-500/30 to-sky-500/30 text-rose-300">
          <Swords size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold text-slate-100">Encounter Board</div>
          <div className="text-[10px] text-slate-500">DM dashboard</div>
        </div>
      </div>

      {/* primary actions */}
      <div className="flex gap-2 px-3 pb-3">
        <Popover
          className="flex-1"
          align="left"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white"
            >
              <Plus size={16} /> New
            </button>
          )}
          panelClassName="w-60"
        >
          {({ close }) => (
            <div className="p-1">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Start from a template
              </div>
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    onNewFromTemplate(t.key);
                    close();
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-slate-800"
                >
                  <span className="text-lg leading-none">{t.emoji}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-200">{t.label}</span>
                    <span className="block text-[11px] leading-tight text-slate-500">
                      {t.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Popover>
        <button
          type="button"
          onClick={onImport}
          title="Import from the 5e SRD bestiary"
          className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-2 text-sm font-semibold text-sky-300 transition hover:bg-sky-500/25"
        >
          <BookOpen size={16} />
        </button>
      </div>

      {/* search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
          <Search size={14} className="text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library…"
            className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
          />
        </div>
      </div>

      {/* library */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {folders.length === 0 && characters.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-600">
            No saved characters yet. Hit <span className="font-semibold text-slate-400">New</span>{" "}
            or import from the bestiary, then file them into folders.
          </p>
        )}

        {folders.map((f) => (
          <FolderSection
            key={f.id}
            folder={f}
            characters={filtered.filter((c) => c.folderId === f.id)}
            encounterActive={encounter.active}
            onEdit={onEdit}
          />
        ))}

        {unfiled.length > 0 && (
          <FolderSection
            folder={null}
            characters={unfiled}
            encounterActive={encounter.active}
            onEdit={onEdit}
          />
        )}
      </div>

      {/* footer: folder + backup */}
      <div className="border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={() => createFolder("New folder")}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
        >
          <FolderPlus size={15} /> New folder
        </button>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={() =>
              downloadBackup({
                version: 1,
                folders,
                characters,
                encounter,
              })
            }
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            title="Download a JSON backup"
          >
            <Download size={14} /> Export
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            title="Restore from a backup file"
          >
            <Upload size={14} /> Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </aside>
  );
}

// ── Folder section (expandable) ─────────────────────────────────────────────

function FolderSection({
  folder,
  characters,
  encounterActive,
  onEdit,
}: {
  folder: Folder | null;
  characters: Character[];
  encounterActive: boolean;
  onEdit: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const renameFolder = useStore((s) => s.renameFolder);
  const recolorFolder = useStore((s) => s.recolorFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder?.name ?? "");

  const color = folder ? folderColor(folder.color) : null;

  return (
    <div className="mb-1">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg px-1.5 py-1",
          folder && color ? color.activeBg : "",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown size={14} className="shrink-0 text-slate-500" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-slate-500" />
          )}
          {color ? (
            <span className={cn("h-2 w-2 shrink-0 rounded-full", color.dot)} />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full border border-slate-600" />
          )}
          {renaming && folder ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                renameFolder(folder.id, name);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameFolder(folder.id, name);
                  setRenaming(false);
                }
                if (e.key === "Escape") setRenaming(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-1 py-0.5 text-xs text-slate-100 outline-none"
            />
          ) : (
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
              {folder ? folder.name : "Unfiled"}
            </span>
          )}
          <span className="shrink-0 text-[10px] text-slate-600">{characters.length}</span>
        </button>

        {folder && (
          <Popover
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="rounded p-0.5 text-slate-500 opacity-0 transition hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100"
                aria-label="Folder menu"
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="w-48">
                <MenuItem
                  icon={<Pencil size={14} />}
                  onClick={() => {
                    setName(folder.name);
                    setRenaming(true);
                    close();
                  }}
                >
                  Rename
                </MenuItem>
                <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Color
                </div>
                <div className="grid grid-cols-8 gap-1 px-2 pb-1.5">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => recolorFolder(folder.id, c.key)}
                      className={cn(
                        "h-4 w-4 rounded-full ring-offset-1 ring-offset-slate-900 transition",
                        c.dot,
                        folder.color === c.key && "ring-2 ring-white/70",
                      )}
                      aria-label={c.label}
                    />
                  ))}
                </div>
                <div className="my-1 border-t border-slate-800" />
                <MenuItem
                  icon={<Trash2 size={14} />}
                  danger
                  onClick={() => {
                    if (
                      confirm(
                        `Delete folder "${folder.name}"? Characters inside it move to Unfiled.`,
                      )
                    ) {
                      deleteFolder(folder.id);
                    }
                    close();
                  }}
                >
                  Delete folder
                </MenuItem>
              </div>
            )}
          </Popover>
        )}
      </div>

      {open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-800 pl-2">
          {characters.length === 0 ? (
            <p className="px-2 py-1 text-[11px] italic text-slate-600">Empty</p>
          ) : (
            characters.map((c) => (
              <LibraryRow
                key={c.id}
                character={c}
                encounterActive={encounterActive}
                onEdit={onEdit}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── A character row inside the library ──────────────────────────────────────

function LibraryRow({
  character: c,
  encounterActive,
  onEdit,
}: {
  character: Character;
  encounterActive: boolean;
  onEdit: (id: string) => void;
}) {
  const addToBoard = useStore((s) => s.addToBoard);
  const removeFromBoard = useStore((s) => s.removeFromBoard);
  const duplicateCharacter = useStore((s) => s.duplicateCharacter);

  return (
    <div
      data-faction={c.faction}
      className="group/row flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-800/70"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
      <button
        type="button"
        onClick={() => onEdit(c.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title="Edit details"
      >
        <span className="shrink-0 text-sm leading-none">{c.emoji ?? "❔"}</span>
        <span className="truncate text-sm text-slate-200">{c.name || "Unnamed"}</span>
        {c.cr && <span className="shrink-0 text-[10px] text-slate-600">CR {c.cr}</span>}
      </button>

      {/* spawn another copy onto the board (great for "3 goblins") */}
      <button
        type="button"
        onClick={() => duplicateCharacter(c.id, { toBoard: true })}
        title="Add a copy to the board"
        className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-slate-700 hover:text-slate-200 group-hover/row:opacity-100"
      >
        <Copy size={13} />
      </button>

      {c.onBoard ? (
        <button
          type="button"
          onClick={() => removeFromBoard(c.id)}
          title="On board — click to remove"
          className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 transition hover:bg-rose-500/20 hover:text-rose-300"
        >
          <Check size={12} />
          {encounterActive ? "In fight" : "On board"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => addToBoard(c.id)}
          title="Add to board"
          className="flex shrink-0 items-center gap-1 rounded-md bg-slate-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:bg-slate-600"
        >
          <Plus size={12} /> Add
        </button>
      )}
    </div>
  );
}
