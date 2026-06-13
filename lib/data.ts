import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isEditorRole, type AppRole, type Entry, type EntryType } from "@/lib/types";

/** The currently logged-in auth user (or null). */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export interface CampaignContext {
  campaignId: string;
  campaignName: string;
  userId: string;
  role: AppRole;
  isEditor: boolean;
}

/**
 * Resolve the viewer's membership + role for a campaign. Returns null if the
 * user isn't signed in or isn't a member (RLS also enforces this on every
 * subsequent query).
 */
export async function getCampaignContext(
  campaignId: string,
): Promise<CampaignContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("campaign_members")
    .select("role, campaigns(name)")
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return null;

  const role = data.role as AppRole;
  const campaignName =
    (data.campaigns as unknown as { name?: string } | null)?.name ?? "Campaign";

  return {
    campaignId,
    campaignName,
    userId: user.id,
    role,
    isEditor: isEditorRole(role),
  };
}

/** Built-in (global) entry types plus any custom to this campaign. */
export async function getEntryTypes(campaignId: string): Promise<EntryType[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("entry_types")
    .select("*")
    .or(`campaign_id.is.null,campaign_id.eq.${campaignId}`)
    .order("sort_order");
  return (data ?? []) as EntryType[];
}

/** Resolve a single entry type for a campaign, preferring a campaign override. */
export async function getEntryType(
  campaignId: string,
  key: string,
): Promise<EntryType | null> {
  const types = await getEntryTypes(campaignId);
  const campaignSpecific = types.find(
    (t) => t.key === key && t.campaign_id === campaignId,
  );
  return campaignSpecific ?? types.find((t) => t.key === key) ?? null;
}

/**
 * id -> current title for the given ids, RLS-scoped to the viewer. Any id the
 * viewer is not allowed to see is simply absent from the map — this is what
 * keeps wiki links to hidden entries from leaking.
 */
export async function getVisibleTitles(
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("entries").select("id,title").in("id", ids);
  for (const row of data ?? []) out.set(row.id as string, row.title as string);
  return out;
}

/** Backlinks: entries (the viewer can see) that link TO the given entry. */
export async function getBacklinks(
  targetEntryId: string,
): Promise<Pick<Entry, "id" | "title" | "type">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("entry_links")
    .select("source:entries!entry_links_source_entry_id_fkey(id,title,type)")
    .eq("target_entry_id", targetEntryId);
  const rows = (data ?? [])
    .map((r) => (r as unknown as { source: Pick<Entry, "id" | "title" | "type"> | null }).source)
    .filter((s): s is Pick<Entry, "id" | "title" | "type"> => !!s);
  return rows;
}
