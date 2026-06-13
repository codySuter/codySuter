"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Create a new campaign/world. The creator becomes its DM (DB trigger). */
export async function createCampaign(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("Campaign name is required");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("campaigns")
    .insert({ name, description: description || null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/campaigns");
  redirect(`/c/${data.id}`);
}
