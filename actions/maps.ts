"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaignContext } from "@/lib/data";

/** Upload a map/image to the private bucket and record an attachment row. */
export async function uploadMap(formData: FormData) {
  const campaignId = String(formData.get("campaignId") ?? "");
  const entryId = String(formData.get("entryId") ?? "") || null;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Please choose an image file");
  }

  const ctx = await getCampaignContext(campaignId);
  if (!ctx?.isEditor) throw new Error("Only editors can upload maps");

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const attachmentId = crypto.randomUUID();
  const path = `${campaignId}/${attachmentId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Upload with the service role (bucket is private).
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("maps")
    .upload(path, bytes, {
      contentType: file.type || "image/png",
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  // Record the access-controlled handle via the RLS-bound client (editor only).
  const supabase = await createClient();
  const { error } = await supabase.from("attachments").insert({
    id: attachmentId,
    campaign_id: campaignId,
    entry_id: entryId,
    storage_path: path,
    kind: "map",
  });
  if (error) {
    // best-effort cleanup of the orphaned object
    await admin.storage.from("maps").remove([path]);
    throw new Error(error.message);
  }

  if (entryId) revalidatePath(`/c/${campaignId}/e/${entryId}`);
}

/** Add a clickable pin on a map linking to a location (or any) entry. */
export async function addMapPin(
  attachmentId: string,
  targetEntryId: string,
  x: number,
  y: number,
  campaignId: string,
  entryId: string,
  label?: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("map_pins").insert({
    attachment_id: attachmentId,
    target_entry_id: targetEntryId,
    x,
    y,
    label: label ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}/e/${entryId}`);
}

export async function deleteMapPin(
  pinId: string,
  campaignId: string,
  entryId: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.from("map_pins").delete().eq("id", pinId);
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}/e/${entryId}`);
}
