import { ScrollText } from "lucide-react";
import { getUser } from "@/lib/data";
import { InviteClient } from "@/components/invite/InviteClient";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getUser();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 text-center">
        <ScrollText className="mx-auto mb-3 text-primary" size={36} />
        <h1 className="mb-1 font-serif text-2xl font-bold">You&rsquo;re invited</h1>
        <p className="mb-6 text-sm text-muted">
          Join a campaign on Campaign Codex.
        </p>
        <InviteClient
          token={token}
          signedIn={!!user}
          email={user?.email ?? null}
        />
      </div>
    </main>
  );
}
