"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { randomToken } from "@/lib/utils";
import type { AppRole } from "@/lib/types";

/** Editor creates an invite; returns the token so the UI can show a share link. */
export async function createInvite(
  campaignId: string,
  email: string,
  role: AppRole,
): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const token = randomToken();

  const { error } = await supabase.from("invites").insert({
    campaign_id: campaignId,
    email: email.trim().toLowerCase(),
    role,
    token,
    invited_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/c/${campaignId}/members`);
  return token;
}

/** Accept an invite via the SECURITY DEFINER function. Returns the campaign id. */
export async function acceptInvite(token: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteInvite(inviteId: string, campaignId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("invites").delete().eq("id", inviteId);
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}/members`);
}

export async function updateMemberRole(
  userId: string,
  campaignId: string,
  role: AppRole,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("campaign_members")
    .update({ role })
    .eq("campaign_id", campaignId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}/members`);
}

export async function removeMember(userId: string, campaignId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("campaign_members")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath(`/c/${campaignId}/members`);
}
