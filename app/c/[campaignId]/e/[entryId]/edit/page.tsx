import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCampaignContext, getEntryType } from "@/lib/data";
import { EntryForm } from "@/components/entry/EntryForm";
import type { Entry } from "@/lib/types";

export default async function EntryEdit({
  params,
}: {
  params: Promise<{ campaignId: string; entryId: string }>;
}) {
  const { campaignId, entryId } = await params;
  const ctx = await getCampaignContext(campaignId);
  if (!ctx?.isEditor) redirect(`/c/${campaignId}/e/${entryId}`);

  const supabase = await createClient();
  const { data } = await supabase
    .from("entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();
  if (!data) notFound();
  const entry = data as Entry;

  const entryType = await getEntryType(campaignId, entry.type);
  if (!entryType) notFound();

  return <EntryForm entry={entry} entryType={entryType} campaignId={campaignId} />;
}
