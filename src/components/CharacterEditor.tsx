import { useState, type ReactNode } from "react";
import { ChevronDown, Plus, Trash2, ImagePlus } from "lucide-react";
import type {
  AbilityKey,
  Action,
  ActionKind,
  Character,
  CharKind,
  Faction,
  TileSize,
} from "../types";
import { useStore } from "../store/useStore";
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  abilityMod,
  formatMod,
  uid,
} from "../lib/dnd";
import { cn } from "../lib/cn";
import { Modal } from "./Modal";
import { Portrait } from "./Portrait";

interface CharacterEditorProps {
  initial: Character;
  isNew: boolean;
  onClose: () => void;
}

const KINDS: CharKind[] = ["monster", "boss", "npc", "pc"];
const FACTIONS: Faction[] = ["enemy", "ally", "neutral"];
const SIZES: TileSize[] = ["small", "medium", "large"];
const ACTION_KINDS: ActionKind[] = ["action", "special", "reaction", "legendary"];

export function CharacterEditor({ initial, isNew, onClose }: CharacterEditorProps) {
  const folders = useStore((s) => s.folders);
  const addCharacter = useStore((s) => s.addCharacter);
  const updateCharacter = useStore((s) => s.updateCharacter);
  const deleteCharacter = useStore((s) => s.deleteCharacter);

  const [draft, setDraft] = useState<Character>(initial);
  const [showMore, setShowMore] = useState(false);

  function patch(p: Partial<Character>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function setAbility(k: AbilityKey, value: number) {
    setDraft((d) => {
      const abilities = { ...d.abilities, [k]: value };
      // keep initiative modifier in sync with DEX unless it was manually diverged
      const initiativeMod =
        k === "dex" && d.initiativeMod === abilityMod(d.abilities.dex)
          ? abilityMod(value)
          : d.initiativeMod;
      return { ...d, abilities, initiativeMod };
    });
  }

  function updateAction(id: string, p: Partial<Action>) {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a) => (a.id === id ? { ...a, ...p } : a)),
    }));
  }

  function addAction() {
    setDraft((d) => ({
      ...d,
      actions: [
        ...d.actions,
        { id: uid(), name: "", desc: "", attackBonus: null, damage: "", kind: "action" },
      ],
    }));
  }

  function removeAction(id: string) {
    setDraft((d) => ({ ...d, actions: d.actions.filter((a) => a.id !== id) }));
  }

  function onImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => patch({ imageUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  function save() {
    const clean: Character = {
      ...draft,
      name: draft.name.trim() || "Unnamed",
      maxHp: Math.max(1, Math.floor(draft.maxHp) || 1),
      hp: Math.max(0, Math.min(Math.floor(draft.hp), Math.max(1, Math.floor(draft.maxHp) || 1))),
      tempHp: Math.max(0, Math.floor(draft.tempHp) || 0),
      ac: Math.max(0, Math.floor(draft.ac) || 0),
    };
    if (isNew) addCharacter(clean);
    else updateCharacter(clean.id, clean);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? "New character" : "Edit character"}
      footer={
        <>
          {!isNew && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${draft.name || "this character"}" permanently?`)) {
                  deleteCharacter(draft.id);
                  onClose();
                }
              }}
              className="mr-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10"
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-white"
          >
            {isNew ? "Add character" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-5" data-faction={draft.faction}>
        {/* portrait + name */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center gap-2">
            <Portrait
              imageUrl={draft.imageUrl}
              emoji={draft.emoji}
              name={draft.name}
              className="h-20 w-20"
              emojiClass="text-4xl"
            />
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
              <ImagePlus size={12} /> Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImageFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="flex-1 space-y-2">
            <Field label="Name">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="e.g. Grukk the Pit Boss"
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Emoji">
                <input
                  value={draft.emoji ?? ""}
                  onChange={(e) => patch({ emoji: e.target.value })}
                  placeholder="🐉"
                  className={inputCls}
                />
              </Field>
              <Field label="Image URL">
                <input
                  value={draft.imageUrl ?? ""}
                  onChange={(e) => patch({ imageUrl: e.target.value })}
                  placeholder="https://…"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
        </div>

        {/* identity */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Type">
            <Segmented
              options={KINDS}
              value={draft.kind}
              onChange={(k) => patch({ kind: k })}
              labels={{ monster: "Monster", boss: "Boss", npc: "NPC", pc: "PC" }}
            />
          </Field>
          <Field label="Faction">
            <Segmented
              options={FACTIONS}
              value={draft.faction}
              onChange={(f) => patch({ faction: f })}
              labels={{ enemy: "Enemy", ally: "Ally", neutral: "Neutral" }}
            />
          </Field>
          <Field label="Tile size">
            <Segmented
              options={SIZES}
              value={draft.size}
              onChange={(s) => patch({ size: s })}
              labels={{ small: "S", medium: "M", large: "L" }}
            />
          </Field>
          <Field label="Folder">
            <select
              value={draft.folderId ?? ""}
              onChange={(e) => patch({ folderId: e.target.value || null })}
              className={inputCls}
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* defenses */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Field label="AC">
            <NumberInput value={draft.ac} onChange={(n) => patch({ ac: n })} />
          </Field>
          <Field label="Max HP">
            <NumberInput value={draft.maxHp} onChange={(n) => patch({ maxHp: n })} />
          </Field>
          <Field label="Current HP">
            <NumberInput value={draft.hp} onChange={(n) => patch({ hp: n })} />
          </Field>
          <Field label="Temp HP">
            <NumberInput value={draft.tempHp} onChange={(n) => patch({ tempHp: n })} />
          </Field>
          <Field label="Init mod">
            <NumberInput
              value={draft.initiativeMod}
              onChange={(n) => patch({ initiativeMod: n })}
            />
          </Field>
          <Field label="CR">
            <input
              value={draft.cr ?? ""}
              onChange={(e) => patch({ cr: e.target.value })}
              placeholder="1/2"
              className={inputCls}
            />
          </Field>
        </div>

        {/* abilities */}
        <Field label="Ability scores">
          <div className="grid grid-cols-6 gap-2">
            {ABILITY_KEYS.map((k) => (
              <div key={k} className="text-center">
                <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                  {ABILITY_LABEL[k]}
                </div>
                <input
                  type="number"
                  value={draft.abilities[k]}
                  onChange={(e) => setAbility(k, parseInt(e.target.value, 10) || 0)}
                  className={cn(inputCls, "text-center")}
                />
                <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                  {formatMod(abilityMod(draft.abilities[k]))}
                </div>
              </div>
            ))}
          </div>
        </Field>

        {/* more details */}
        <div>
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
          >
            <ChevronDown
              size={14}
              className={cn("transition", showMore ? "rotate-0" : "-rotate-90")}
            />
            More details
          </button>
          {showMore && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Creature type">
                <input
                  value={draft.creatureType ?? ""}
                  onChange={(e) => patch({ creatureType: e.target.value })}
                  placeholder="humanoid"
                  className={inputCls}
                />
              </Field>
              <Field label="D&D size">
                <input
                  value={draft.dndSize ?? ""}
                  onChange={(e) => patch({ dndSize: e.target.value })}
                  placeholder="Medium"
                  className={inputCls}
                />
              </Field>
              <Field label="Alignment">
                <input
                  value={draft.alignment ?? ""}
                  onChange={(e) => patch({ alignment: e.target.value })}
                  placeholder="chaotic evil"
                  className={inputCls}
                />
              </Field>
              <Field label="Speed">
                <input
                  value={draft.speed ?? ""}
                  onChange={(e) => patch({ speed: e.target.value })}
                  placeholder="30 ft."
                  className={inputCls}
                />
              </Field>
              <Field label="Senses">
                <input
                  value={draft.senses ?? ""}
                  onChange={(e) => patch({ senses: e.target.value })}
                  placeholder="darkvision 60 ft."
                  className={inputCls}
                />
              </Field>
              <Field label="Languages">
                <input
                  value={draft.languages ?? ""}
                  onChange={(e) => patch({ languages: e.target.value })}
                  placeholder="Common"
                  className={inputCls}
                />
              </Field>
            </div>
          )}
        </div>

        {/* actions */}
        <Field
          label="Actions & traits"
          action={
            <button
              type="button"
              onClick={addAction}
              className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              <Plus size={12} /> Add
            </button>
          }
        >
          <div className="space-y-2">
            {draft.actions.length === 0 && (
              <p className="text-xs italic text-slate-500">
                No actions. Add attacks, spells, or traits — or import an SRD creature to get them
                pre-filled.
              </p>
            )}
            {draft.actions.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
                <div className="flex gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => updateAction(a.id, { name: e.target.value })}
                    placeholder="Action name"
                    className={cn(inputCls, "flex-1 font-medium")}
                  />
                  <select
                    value={a.kind}
                    onChange={(e) => updateAction(a.id, { kind: e.target.value as ActionKind })}
                    className={cn(inputCls, "w-28")}
                  >
                    {ACTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeAction(a.id)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
                    aria-label="Remove action"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <div className="w-24">
                    <NumberInput
                      value={a.attackBonus ?? 0}
                      onChange={(n) => updateAction(a.id, { attackBonus: n })}
                      placeholder="+hit"
                    />
                  </div>
                  <input
                    value={a.damage ?? ""}
                    onChange={(e) => updateAction(a.id, { damage: e.target.value })}
                    placeholder="2d6+3 slashing"
                    className={cn(inputCls, "flex-1")}
                  />
                </div>
                <textarea
                  value={a.desc}
                  onChange={(e) => updateAction(a.id, { desc: e.target.value })}
                  placeholder="Description (range, save DC, effect…)"
                  rows={2}
                  className={cn(inputCls, "mt-2 resize-y")}
                />
              </div>
            ))}
          </div>
        </Field>

        {/* notes */}
        <Field label="DM notes">
          <textarea
            value={draft.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Tactics, secrets, loot, motivations…"
            rows={3}
            className={cn(inputCls, "resize-y")}
          />
        </Field>
      </div>
    </Modal>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 outline-none transition focus:border-slate-500 placeholder-slate-600";

function Field({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {action}
      </div>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      placeholder={placeholder}
      className={cn(inputCls, "tabular-nums")}
    />
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-700">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 px-2 py-1.5 text-xs font-medium transition",
            value === opt
              ? "bg-slate-700 text-slate-100"
              : "text-slate-400 hover:bg-slate-800",
          )}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}
