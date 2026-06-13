"use client";

import { useState } from "react";
import { ScrollText, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const next =
      new URLSearchParams(window.location.search).get("next") || "/campaigns";
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <ScrollText className="mb-3 text-primary" size={36} />
          <h1 className="font-serif text-2xl font-bold">Campaign Codex</h1>
          <p className="mt-1 text-sm text-muted">
            Sign in with a magic link — no password needed.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-center text-sm">
            <Mail className="mx-auto mb-2 text-accent" size={22} />
            Check <span className="font-medium">{email}</span> for a sign-in
            link. You can close this tab once you click it.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center"
              disabled={loading}
            >
              {loading ? "Sending…" : "Email me a link"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
