import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES Row Level Security — use ONLY inside trusted
 * server code, and only AFTER you have independently verified the caller is
 * allowed to do the thing (e.g. confirmed they are a campaign editor via the
 * RLS-bound server client). Today its sole job is minting short-lived signed
 * URLs for / uploading to the private `maps` storage bucket.
 *
 * The "server-only" import guarantees this module can never be bundled into
 * client code.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
