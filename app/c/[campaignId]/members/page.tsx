import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCampaignContext } from "@/lib/data";
import { MembersClient } from "@/components/members/MembersClient";
import type { AppRole } from "@/lib/types";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const ctx = await getCampaignContext(campaignId);
  if (!ctx?.isEditor) redirect(`/c/${campaignId}`);

  const supabase = await createClient();

  const { data: memberRows } = await supabase
    .from("campaign_members")
    .select("user_id, role")
    .eq("campaign_id", campaignId);

  const ids = (memberRows ?? []).map((m) => m.user_id as string);
  const { data: profileRows } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string | null }[] };

  const nameById = new Map(
    (profileRows ?? []).map((p) => [p.id as string, p.display_name as string | null]),
  );

  const members = (memberRows ?? []).map((m) => ({
    userId: m.user_id as string,
    role: m.role as AppRole,
    name: nameById.get(m.user_id as string) ?? "Unknown",
  }));

  const { data: inviteRows } = await supabase
    .from("invites")
    .select("id,email,role,token,created_at")
    .eq("campaign_id", campaignId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  const invites = (inviteRows ?? []).map((i) => ({
    id: i.id as string,
    email: i.email as string,
    role: i.role as AppRole,
    token: i.token as string,
  }));

  return (
    <MembersClient
      campaignId={campaignId}
      currentUserId={ctx.userId}
      members={members}
      invites={invites}
    />
  );
}
