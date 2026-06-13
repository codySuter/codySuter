import Link from "next/link";
import { ScrollText, Plus, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createCampaign } from "@/actions/campaigns";
import { signOut } from "@/actions/auth";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { Button } from "@/components/ui/button";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("campaign_members")
    .select("role, campaign:campaigns(id,name,description)")
    .eq("user_id", user!.id);

  const rows = (memberships ?? []) as unknown as {
    role: AppRole;
    campaign: { id: string; name: string; description: string | null } | null;
  }[];

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="text-primary" size={26} />
          <h1 className="font-serif text-2xl font-bold">Campaign Codex</h1>
        </div>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            <LogOut size={15} /> Sign out
          </Button>
        </form>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Your worlds
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-6 text-sm text-muted">
            You&rsquo;re not in any campaigns yet. Create your first world below,
            or ask a DM for an invite link.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map(
              (r) =>
                r.campaign && (
                  <li key={r.campaign.id}>
                    <Link
                      href={`/c/${r.campaign.id}`}
                      className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-primary"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-serif text-lg font-semibold">
                          {r.campaign.name}
                        </span>
                        <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">
                          {ROLE_LABELS[r.role]}
                        </span>
                      </div>
                      {r.campaign.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted">
                          {r.campaign.description}
                        </p>
                      )}
                    </Link>
                  </li>
                ),
            )}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Plus size={16} /> New campaign
        </h2>
        <form action={createCampaign} className="space-y-3">
          <input
            name="name"
            required
            placeholder="Name (e.g. The Shattered Realms)"
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <textarea
            name="description"
            placeholder="A short description (optional)"
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <Button type="submit" variant="primary">
            Create world
          </Button>
        </form>
      </section>
    </main>
  );
}
