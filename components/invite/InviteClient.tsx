"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { acceptInvite } from "@/actions/invites";
import { Button } from "@/components/ui/button";

export function InviteClient({
  token,
  signedIn,
  email,
}: {
  token: string;
  signedIn: boolean;
  email: string | null;
}) {
  const router = useRouter();
  const [inputEmail, setInputEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in: offer to accept.
  if (signedIn) {
    const accept = async () => {
      setBusy(true);
      setError(null);
      try {
        const campaignId = await acceptInvite(token);
        router.push(`/c/${campaignId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not accept invite");
        setBusy(false);
      }
    };
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Signed in as <span className="text-text">{email}</span>
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          variant="primary"
          className="w-full justify-center"
          onClick={accept}
          disabled={busy}
        >
          {busy ? "Joining…" : "Accept invitation"}
        </Button>
        <p className="text-xs text-muted">
          The invite must match the email you signed in with.
        </p>
      </div>
    );
  }

  // Not signed in: send a magic link that returns to this invite page.
  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: inputEmail.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(
          `/invite/${token}`,
        )}`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  if (sent) {
    return (
      <p className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
        Check <span className="font-medium">{inputEmail}</span> for a sign-in
        link, then you&rsquo;ll be brought back here to join.
      </p>
    );
  }

  return (
    <form onSubmit={sendLink} className="space-y-3">
      <p className="text-left text-sm text-muted">
        Enter the email this invite was sent to:
      </p>
      <input
        type="email"
        required
        autoFocus
        placeholder="you@example.com"
        value={inputEmail}
        onChange={(e) => setInputEmail(e.target.value)}
        className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        className="w-full justify-center"
        disabled={busy}
      >
        {busy ? "Sending…" : "Continue"}
      </Button>
    </form>
  );
}
