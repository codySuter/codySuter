import {
  Copy,
  LogOut,
  MoreVertical,
  Pencil,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Character, Faction, TileSize } from "../types";
import { useStore } from "../store/useStore";
import { FACTION_LABEL, KIND_LABEL, formatMod } from "../lib/dnd";
import { cn } from "../lib/cn";
import { Portrait } from "./Portrait";
import { HpControl } from "./HpControl";
import { AbilityBlock } from "./AbilityBlock";
import { ConditionControl } from "./ConditionControl";
import { ActionList } from "./ActionList";
import { Popover, MenuItem } from "./Popover";

const SIZE_SPAN: Record<TileSize, string> = {
  small: "col-span-1 row-span-2",
  medium: "col-span-1 sm:col-span-2 row-span-2",
  large: "col-span-1 sm:col-span-2 row-span-3",
};

const SIZE_CYCLE: TileSize[] = ["small", "medium", "large"];
const SIZE_GLYPH: Record<TileSize, string> = { small: "S", medium: "M", large: "L" };

const FACTIONS: Faction[] = ["enemy", "ally", "neutral"];

interface CharacterCardProps {
  character: Character;
  isTurn: boolean;
  onEdit: (id: string) => void;
}

export function CharacterCard({ character: c, isTurn, onEdit }: CharacterCardProps) {
  const folders = useStore((s) => s.folders);
  const applyDamage = useStore((s) => s.applyDamage);
  const applyHeal = useStore((s) => s.applyHeal);
  const setTempHp = useStore((s) => s.setTempHp);
  const toggleCondition = useStore((s) => s.toggleCondition);
  const setConditionRounds = useStore((s) => s.setConditionRounds);
  const setSize = useStore((s) => s.setSize);
  const setFaction = useStore((s) => s.setFaction);
  const setFolder = useStore((s) => s.setFolder);
  const duplicateCharacter = useStore((s) => s.duplicateCharacter);
  const removeFromBoard = useStore((s) => s.removeFromBoard);
  const deleteCharacter = useStore((s) => s.deleteCharacter);

  const showAbilities = c.size !== "small";
  const actionLimit = c.size === "large" ? undefined : c.size === "medium" ? 4 : 2;
  const showActions = c.size !== "small" || c.actions.length > 0;
  const down = c.hp <= 0;

  return (
    <div
      data-faction={c.faction}
      data-testid="character-card"
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-slate-900/80 p-3 transition",
        SIZE_SPAN[c.size],
        isTurn ? "turn-active" : "",
        down && "opacity-75 grayscale",
      )}
      style={{
        borderColor: isTurn ? "var(--accent)" : "var(--accent-border)",
        boxShadow: isTurn ? undefined : "inset 0 1px 0 0 rgba(255,255,255,0.03)",
      }}
    >
      {/* accent top stripe */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style={{ background: "var(--accent)" }}
      />

      {/* ── header ── */}
      <div className="mb-2 flex items-start gap-2">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: "var(--accent)" }}
          title={FACTION_LABEL[c.faction]}
        />
        <button
          type="button"
          onClick={() => onEdit(c.id)}
          className="min-w-0 flex-1 text-left"
          title="Edit details"
        >
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-semibold leading-tight text-slate-100">
              {c.name || "Unnamed"}
            </h3>
            {isTurn && (
              <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">
                Turn
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span>{KIND_LABEL[c.kind]}</span>
            {c.cr && <span>· CR {c.cr}</span>}
            {c.creatureType && c.size !== "small" && (
              <span className="truncate">· {c.creatureType}</span>
            )}
          </div>
        </button>

        {/* size cycle */}
        <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-700">
          {SIZE_CYCLE.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(c.id, s)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] font-bold transition",
                c.size === s
                  ? "bg-slate-700 text-slate-100"
                  : "text-slate-500 hover:bg-slate-800 hover:text-slate-300",
              )}
              title={`${s} tile`}
            >
              {SIZE_GLYPH[s]}
            </button>
          ))}
        </div>

        {/* menu */}
        <Popover
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200",
                open && "bg-slate-800 text-slate-200",
              )}
              aria-label="Card menu"
            >
              <MoreVertical size={16} />
            </button>
          )}
        >
          {({ close }) => (
            <div className="w-52">
              <MenuItem
                icon={<Pencil size={14} />}
                onClick={() => {
                  close();
                  onEdit(c.id);
                }}
              >
                Edit details
              </MenuItem>
              <MenuItem
                icon={<Copy size={14} />}
                onClick={() => {
                  duplicateCharacter(c.id, { toBoard: true });
                  close();
                }}
              >
                Duplicate to board
              </MenuItem>

              <div className="my-1 border-t border-slate-800" />
              <div className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Faction
              </div>
              <div className="flex gap-1 px-2 pb-1">
                {FACTIONS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    data-faction={f}
                    onClick={() => setFaction(c.id, f)}
                    className={cn(
                      "flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium capitalize transition",
                      c.faction === f
                        ? "text-[var(--accent)] ring-1 ring-[var(--accent-border)]"
                        : "text-slate-400 hover:bg-slate-800",
                    )}
                    style={{ background: c.faction === f ? "var(--accent-soft)" : undefined }}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="my-1 border-t border-slate-800" />
              <label className="block px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Move to folder
              </label>
              <div className="px-2 pb-1.5">
                <select
                  value={c.folderId ?? ""}
                  onChange={(e) => setFolder(c.id, e.target.value || null)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-slate-500"
                >
                  <option value="">Unfiled</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="my-1 border-t border-slate-800" />
              <MenuItem
                icon={<LogOut size={14} />}
                onClick={() => {
                  removeFromBoard(c.id);
                  close();
                }}
              >
                Remove from board
              </MenuItem>
              <MenuItem
                icon={<Trash2 size={14} />}
                danger
                onClick={() => {
                  if (confirm(`Delete "${c.name || "this character"}" permanently?`)) {
                    deleteCharacter(c.id);
                  }
                  close();
                }}
              >
                Delete character
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>

      {/* ── body: portrait + core stats ── */}
      <div className="flex gap-3">
        <Portrait
          imageUrl={c.imageUrl}
          emoji={c.emoji}
          name={c.name}
          className={cn(
            c.size === "large" ? "h-24 w-24" : c.size === "medium" ? "h-20 w-20" : "h-16 w-16",
          )}
          emojiClass={c.size === "small" ? "text-2xl" : "text-4xl"}
        />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatPill icon={<Shield size={13} />} label="AC" value={c.ac} />
            <StatPill
              icon={<Sparkles size={13} />}
              label="Init"
              value={
                c.initiative != null ? c.initiative : formatMod(c.initiativeMod)
              }
              hint={c.initiative != null ? "rolled" : "modifier"}
            />
          </div>
          <HpControl
            hp={c.hp}
            maxHp={c.maxHp}
            tempHp={c.tempHp}
            onDamage={(n) => applyDamage(c.id, n)}
            onHeal={(n) => applyHeal(c.id, n)}
            onSetTemp={(n) => setTempHp(c.id, n)}
            compact={c.size === "small"}
          />
        </div>
      </div>

      {/* ── conditions ── */}
      <div className="mt-2">
        <ConditionControl
          conditions={c.conditions}
          onToggle={(name) => toggleCondition(c.id, name)}
          onSetRounds={(name, rounds) => setConditionRounds(c.id, name, rounds)}
          size={c.size === "small" ? "compact" : "full"}
        />
      </div>

      {/* ── abilities ── */}
      {showAbilities && (
        <div className="mt-2">
          <AbilityBlock abilities={c.abilities} />
        </div>
      )}

      {/* ── actions ── */}
      {showActions && (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
          <ActionList
            actions={c.actions}
            compact={c.size !== "large"}
            flat={c.size !== "large"}
            maxItems={actionLimit}
          />
        </div>
      )}
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg bg-slate-950/50 px-2 py-1"
      title={hint ? `${label} (${hint})` : label}
    >
      <span className="text-slate-500">{icon}</span>
      <span className="text-[10px] font-semibold uppercase text-slate-500">{label}</span>
      <span className="text-sm font-bold tabular-nums text-slate-100">{value}</span>
    </div>
  );
}
