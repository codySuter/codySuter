"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Trash2, Check, Loader2 } from "lucide-react";
import { deleteEntry, saveEntry } from "@/actions/entries";
import { Editor } from "@/components/editor/Editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Entry,
  EntryType,
  FieldDef,
  TiptapDoc,
  Visibility,
} from "@/lib/types";

const inputCls =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-primary";

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  if (def.type === "textarea") {
    return (
      <textarea
        className={cn(inputCls, "min-h-[72px] resize-y")}
        placeholder={def.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (def.type === "select") {
    return (
      <select
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {(def.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={def.type === "number" ? "number" : def.type === "url" ? "url" : "text"}
      className={inputCls}
      placeholder={def.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function EntryForm({
  entry,
  entryType,
  campaignId,
}: {
  entry: Entry;
  entryType: EntryType;
  campaignId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(entry.title);
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const def of entryType.field_schema ?? []) {
      const v = entry.fields?.[def.key];
      f[def.key] = v == null ? "" : String(v);
    }
    return f;
  });
  const [body, setBody] = useState<TiptapDoc>(
    entry.body ?? { type: "doc", content: [{ type: "paragraph" }] },
  );
  const [visibility, setVisibility] = useState<Visibility>(entry.visibility);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveEntry({
          entryId: entry.id,
          campaignId,
          title,
          fields,
          body,
          visibility,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  };

  const remove = () => {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    startTransition(async () => {
      try {
        await deleteEntry(entry.id, campaignId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete");
      }
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        <span className="rounded bg-surface-2 px-2 py-0.5">{entryType.label}</span>
        <span>editing</span>
      </div>

      <input
        className="w-full bg-transparent text-3xl font-bold text-text placeholder:text-muted focus:outline-none font-serif"
        placeholder={`Untitled ${entryType.label}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {/* Visibility toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Players can see this:</span>
        <div className="inline-flex rounded-md border border-line overflow-hidden">
          <button
            type="button"
            onClick={() => setVisibility("dm_only")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm",
              visibility === "dm_only"
                ? "bg-surface-2 text-text"
                : "text-muted hover:text-text",
            )}
          >
            <EyeOff size={14} /> Hidden
          </button>
          <button
            type="button"
            onClick={() => setVisibility("players")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm",
              visibility === "players"
                ? "bg-accent/25 text-text"
                : "text-muted hover:text-text",
            )}
          >
            <Eye size={14} /> Revealed
          </button>
        </div>
      </div>

      {/* Structured fields */}
      {(entryType.field_schema ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-line bg-surface p-4">
          {entryType.field_schema.map((def) => (
            <label key={def.key} className="block space-y-1">
              <span className="text-xs font-medium text-muted">{def.label}</span>
              <FieldInput
                def={def}
                value={fields[def.key] ?? ""}
                onChange={(v) => setFields((f) => ({ ...f, [def.key]: v }))}
              />
            </label>
          ))}
        </div>
      )}

      {/* Body */}
      <Editor campaignId={campaignId} initialContent={body} onChange={setBody} />

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-bg/80 py-3 backdrop-blur">
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : saved ? (
            <Check size={16} />
          ) : null}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.push(`/c/${campaignId}/e/${entry.id}`)}
        >
          View
        </Button>
        <Button variant="danger" onClick={remove} className="ml-auto">
          <Trash2 size={16} /> Delete
        </Button>
      </div>
    </div>
  );
}
