import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Mint a short-lived signed URL for a private map image. CALL ONLY after the
 * corresponding `attachments` row has been fetched through the RLS-bound
 * server client (i.e. you've proven the viewer is allowed to see it).
 */
export async function signedMapUrl(
  storagePath: string,
  expiresIn = 60 * 60,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from("maps")
    .createSignedUrl(storagePath, expiresIn);
  return data?.signedUrl ?? null;
}
