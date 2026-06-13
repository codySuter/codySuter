import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCampaignContext, getEntryTypes } from "@/lib/data";
import { EntryCard } from "@/components/entry/EntryCard";
import type { Visibility } from "@/lib/types";

export default async function EntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { campaignId } = await params;
  const { type: typeFilter } = await searchParams;
  const ctx = await getCampaignContext(campaignId);
  const isEditor = ctx?.isEditor ?? false;

  const supabase = await createClient();
  const types = await getEntryTypes(campaignId);
  const typeMap = new Map(types.map((t) => [t.key, t]));

  let query = supabase
    .from("entries")
    .select("id,title,type,visibility,updated_at")
    .eq("campaign_id", campaignId)
    .order("title", { ascending: true });
  if (typeFilter) query = query.eq("type", typeFilter);

  const { data } = await query;
  const rows = (data ?? []) as {
    id: string;
    title: string;
    type: string;
    visibility: Visibility;
  }[];

  const base = `/c/${campaignId}/entries`;

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-bold">
        {typeFilter ? (typeMap.get(typeFilter)?.label ?? typeFilter) : "All entries"}
      </h1>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={base}
          className={`rounded-full border px-3 py-1 text-sm ${
            !typeFilter
              ? "border-primary bg-primary/15 text-text"
              : "border-line bg-surface text-muted hover:text-text"
          }`}
        >
          All
        </Link>
        {types.map((t) => (
          <Link
            key={t.id}
            href={`${base}?type=${t.key}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              typeFilter === t.key
                ? "border-primary bg-primary/15 text-text"
                : "border-line bg-surface text-muted hover:text-text"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-sm text-muted">
          Nothing here yet.
        </p>
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
    </div>
  );
}
