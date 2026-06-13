import { ImagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signedMapUrl } from "@/lib/maps";
import { uploadMap } from "@/actions/maps";
import { MapView } from "./MapView";
import { Button } from "@/components/ui/button";

/**
 * Lists the maps attached to an entry (each served via a signed URL minted only
 * after the attachments row passes RLS) and, for editors, an upload form.
 */
export async function MapSection({
  campaignId,
  entryId,
  isEditor,
}: {
  campaignId: string;
  entryId: string;
  isEditor: boolean;
}) {
  const supabase = await createClient();
  const { data: attachments } = await supabase
    .from("attachments")
    .select("id,storage_path")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });

  const maps = await Promise.all(
    (attachments ?? []).map(async (a) => ({
      id: a.id as string,
      url: await signedMapUrl(a.storage_path as string),
    })),
  );

  return (
    <section className="space-y-3">
      {maps.map((m) => m.url && <MapView key={m.id} url={m.url} />)}

      {maps.length === 0 && !isEditor && (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
          No map uploaded yet.
        </p>
      )}

      {isEditor && (
        <form
          action={uploadMap}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-surface p-3"
        >
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="entryId" value={entryId} />
          <ImagePlus size={16} className="text-muted" />
          <input
            type="file"
            name="file"
            accept="image/*"
            required
            className="text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-text"
          />
          <Button type="submit" variant="secondary" size="sm">
            Upload map
          </Button>
        </form>
      )}
    </section>
  );
}
