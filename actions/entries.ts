"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEntryType } from "@/lib/data";
import { extractLinkIds, extractPlainText } from "@/lib/entries/process";
import type { FieldDef, TiptapDoc, Visibility } from "@/lib/types";

/** Create a new entry from a type's template and jump straight into editing. */
export async function createEntry(campaignId: string, typeKey: string) {
  const supabase = await createClient();
  const type = await getEntryType(campaignId, typeKey);
  if (!type) throw new Error(`Unknown entry type: ${typeKey}`);

  // Seed structured fields from the schema (all blank).
  const fields: Record<string, unknown> = {};
  for (const f of (type.field_schema ?? []) as FieldDef[]) fields[f.key] = "";

  const { data, error } = await supabase
    .from("entries")
    .insert({
      campaign_id: campaignId,
      type: typeKey,
      title: `Untitled ${type.label}`,
      fields,
      body: type.body_template ?? { type: "doc", content: [{ type: "paragraph" }] },
      visibility: "dm_only",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/c/${campaignId}`);
  redirect(`/c/${campaignId}/e/${data.id}/edit`);
}

interface SaveEntryInput {
  entryId: string;
  campaignId: string;
  title: string;
  fields: Record<string, unknown>;
  body: TiptapDoc;
  visibility: Visibility;
}

/** Save an entry: persist body, fields, title, visibility; sync wiki-link edges. */
export async function saveEntry(input: SaveEntryInput) {
  const supabase = await createClient();
  const { entryId, campaignId, title, fields, body, visibility } = input;

  const bodyText = extractPlainText(body);
  const ddbUrl =
    typeof fields.ddb_url === "string" && fields.ddb_url.trim().length > 0
      ? (fields.ddb_url as string).trim()
      : null;

  const { error } = await supabase
    .from("entries")
    .update({
      title: title.trim() || "Untitled",
      fields,
      body,
      body_text: bodyText,
      visibility,
      ddb_url: ddbUrl,
    })
    .eq("id", entryId);

  if (error) throw new Error(error.message);

  // --- sync entry_links (backlinks) ---------------------------------------
  const targetIds = extractLinkIds(body).filter((id) => id !== entryId);

  const { data: existing } = await supabase
    .from("entry_links")
    .select("target_entry_id")
    .eq("source_entry_id", entryId);
  const existingSet = new Set(
    (existing ?? []).map((r) => r.target_entry_id as string),
  );
  const wanted = new Set(targetIds);

  const toAdd = [...wanted].filter((id) => !existingSet.has(id));
  const toRemove = [...existingSet].filter((id) => !wanted.has(id));

  if (toRemove.length > 0) {
    await supabase
      .from("entry_links")
      .delete()
      .eq("source_entry_id", entryId)
      .in("target_entry_id", toRemove);
  }
  if (toAdd.length > 0) {
    await supabase
      .from("entry_links")
      .insert(toAdd.map((t) => ({ source_entry_id: entryId, target_entry_id: t })));
  }

  revalidatePath(`/c/${campaignId}/e/${entryId}`);
  revalidatePath(`/c/${campaignId}`);
}

/** Quick visibility toggle (reveal to players / hide). Editors only (RLS). */
export async function setVisibility(
  entryId: string,
  campaignId: string,
  visibility: Visibility,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("entries")
    .update({ visibility })
    .eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}/e/${entryId}`);
  revalidatePath(`/c/${campaignId}`);
}

export async function deleteEntry(entryId: string, campaignId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("entries").delete().eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}`);
  redirect(`/c/${campaignId}/entries`);
}

/**
 * Create a stub entry on the fly (used by the editor's "[[ create new ]]"
 * affordance). Returns the new id + title so the editor can insert a link
 * immediately — essential for fast, improv play.
 */
export async function createStubEntry(
  campaignId: string,
  title: string,
  typeKey = "npc",
): Promise<{ id: string; title: string }> {
  const supabase = await createClient();
  const clean = title.trim() || "Untitled";
  const { data, error } = await supabase
    .from("entries")
    .insert({
      campaign_id: campaignId,
      type: typeKey,
      title: clean,
      visibility: "dm_only",
      body: { type: "doc", content: [{ type: "paragraph" }] },
    })
    .select("id,title")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, title: data.title as string };
}

/** Live search of entries by title for the wiki-link autocomplete (RLS-scoped). */
export async function searchEntries(
  campaignId: string,
  query: string,
): Promise<{ id: string; title: string; type: string }[]> {
  const supabase = await createClient();
  let q = supabase
    .from("entries")
    .select("id,title,type")
    .eq("campaign_id", campaignId)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (query.trim().length > 0) q = q.ilike("title", `%${query.trim()}%`);
  const { data } = await q;
  return (data ?? []) as { id: string; title: string; type: string }[];
}
