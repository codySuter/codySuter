import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getBacklinks,
  getCampaignContext,
  getEntryType,
  getVisibleTitles,
} from "@/lib/data";
import { extractLinkIds } from "@/lib/entries/process";
import { RenderBody } from "@/lib/entries/render";
import { RevealToggle } from "@/components/entry/RevealToggle";
import { MapSection } from "@/components/maps/MapSection";
import { TypeIcon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import type { Entry, FieldDef } from "@/lib/types";

export default async function EntryView({
  params,
}: {
  params: Promise<{ campaignId: string; entryId: string }>;
}) {
  const { campaignId, entryId } = await params;
  const ctx = await getCampaignContext(campaignId);
  const isEditor = ctx?.isEditor ?? false;

  const supabase = await createClient();
  // RLS decides whether this row is returnable at all. A player hitting a
  // hidden entry simply gets null here -> 404.
  const { data } = await supabase
    .from("entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();
  if (!data) notFound();
  const e = data as Entry;

  const entryType = await getEntryType(campaignId, e.type);
  const visibleTitles = await getVisibleTitles(extractLinkIds(e.body));
  const backlinks = await getBacklinks(e.id);

  const fieldDefs = (entryType?.field_schema ?? []) as FieldDef[];
  const shownFields = fieldDefs.filter(
    (d) =>
      d.key !== "ddb_url" &&
      String(e.fields?.[d.key] ?? "").trim() !== "",
  );

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          <TypeIcon name={entryType?.icon} size={16} />
          <span>{entryType?.label ?? e.type}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-bold">{e.title}</h1>
          {isEditor && (
            <RevealToggle
              entryId={e.id}
              campaignId={campaignId}
              visibility={e.visibility}
            />
          )}
          {isEditor && (
            <Link href={`/c/${campaignId}/e/${e.id}/edit`} className="ml-auto">
              <Button size="sm" variant="secondary">
                <Pencil size={14} /> Edit
              </Button>
            </Link>
          )}
        </div>
      </header>

      {e.ddb_url && (
        <a
          href={e.ddb_url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm hover:border-primary"
        >
          <ExternalLink size={15} />
          {"Open D&D Beyond character sheet"}
        </a>
      )}

      {shownFields.length > 0 && (
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
          {shownFields.map((d) => (
            <div key={d.key} className="flex justify-between gap-3 text-sm">
              <dt className="text-muted">{d.label}</dt>
              <dd className="text-right text-text">{String(e.fields[d.key])}</dd>
            </div>
          ))}
        </dl>
      )}

      {e.type === "map" && (
        <MapSection campaignId={campaignId} entryId={e.id} isEditor={isEditor} />
      )}

      <RenderBody
        doc={e.body}
        campaignId={campaignId}
        visibleTitles={visibleTitles}
        showSecrets={isEditor}
      />

      {backlinks.length > 0 && (
        <section className="border-t border-line pt-4">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">
            Mentioned in
          </h2>
          <ul className="flex flex-wrap gap-2">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/c/${campaignId}/e/${b.id}`}
                  className="rounded-md border border-line bg-surface px-2.5 py-1 text-sm text-muted hover:border-primary hover:text-text"
                >
                  {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
