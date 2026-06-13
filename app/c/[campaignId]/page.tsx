import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCampaignContext, getEntryTypes } from "@/lib/data";
import { EntryCard } from "@/components/entry/EntryCard";
import { TypeIcon } from "@/components/icon";
import type { Visibility } from "@/lib/types";

export default async function CampaignHome({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const ctx = await getCampaignContext(campaignId);
  const isEditor = ctx?.isEditor ?? false;

  const supabase = await createClient();
  const types = await getEntryTypes(campaignId);
  const typeMap = new Map(types.map((t) => [t.key, t]));

  const { data: entries } = await supabase
    .from("entries")
    .select("id,title,type,visibility,updated_at")
    .eq("campaign_id", campaignId)
    .order("updated_at", { ascending: false })
    .limit(24);

  const rows = (entries ?? []) as {
    id: string;
    title: string;
    type: string;
    visibility: Visibility;
    updated_at: string;
  }[];

  return (
    <div className="space-y-8">
      {/* Browse by type */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Browse
        </h2>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <Link
              key={t.id}
              href={`/c/${campaignId}/entries?type=${t.key}`}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:border-primary hover:text-text"
            >
              <TypeIcon name={t.icon} size={14} />
              {t.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Recently updated */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Recently updated
        </h2>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface p-6 text-sm text-muted">
            {isEditor ? (
              <>
                Nothing here yet. Press{" "}
                <kbd className="rounded bg-surface-2 px-1.5 py-0.5">⌘/Ctrl&nbsp;K</kbd>{" "}
                or the <span className="text-text">New</span> button to add your
                first NPC, location or note.
              </>
            ) : (
              "Your DM hasn't revealed anything yet. Check back after your next session!"
            )}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((e) => (
              <EntryCard
                key={e.id}
                href={`/c/${campaignId}/e/${e.id}`}
                title={e.title}
                typeLabel={typeMap.get(e.type)?.label ?? e.type}
                icon={typeMap.get(e.type)?.icon ?? null}
                visibility={e.visibility}
                isEditor={isEditor}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
