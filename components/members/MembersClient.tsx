"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Trash2, UserPlus } from "lucide-react";
import {
  createInvite,
  deleteInvite,
  removeMember,
  updateMemberRole,
} from "@/actions/invites";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface Member {
  userId: string;
  role: AppRole;
  name: string;
}
interface Invite {
  id: string;
  email: string;
  role: AppRole;
  token: string;
}

const selectCls =
  "rounded-md border border-line bg-surface-2 px-2 py-1 text-sm focus:border-primary focus:outline-none";

export function MembersClient({
  campaignId,
  currentUserId,
  members,
  invites,
}: {
  campaignId: string;
  currentUserId: string;
  members: Member[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("player");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteLink = (token: string) => `${origin}/invite/${token}`;

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteLink(token));
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        await createInvite(campaignId, email, role);
        setEmail("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create invite");
      }
    });
  };

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-bold">Members &amp; invites</h1>
      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Members */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          Members
        </h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {members.map((m) => {
            const self = m.userId === currentUserId;
            return (
              <li
                key={m.userId}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="flex-1 truncate">
                  {m.name}
                  {self && <span className="ml-2 text-xs text-muted">(you)</span>}
                </span>
                <select
                  className={selectCls}
                  value={m.role}
                  disabled={self || pending}
                  onChange={(e) =>
                    run(() =>
                      updateMemberRole(
                        m.userId,
                        campaignId,
                        e.target.value as AppRole,
                      ),
                    )
                  }
                >
                  <option value="dm">{ROLE_LABELS.dm}</option>
                  <option value="co_dm">{ROLE_LABELS.co_dm}</option>
                  <option value="player">{ROLE_LABELS.player}</option>
                </select>
                <button
                  className="text-muted hover:text-danger disabled:opacity-30"
                  disabled={self || pending}
                  title="Remove member"
                  onClick={() => run(() => removeMember(m.userId, campaignId))}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Create invite */}
      <section className="space-y-3 rounded-lg border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <UserPlus size={16} /> Invite someone
        </h2>
        <form onSubmit={submitInvite} className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            required
            placeholder="their@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <select
            className={selectCls}
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
          >
            <option value="player">{ROLE_LABELS.player}</option>
            <option value="co_dm">{ROLE_LABELS.co_dm}</option>
            <option value="dm">{ROLE_LABELS.dm}</option>
          </select>
          <Button type="submit" variant="primary" disabled={pending}>
            Create link
          </Button>
        </form>
        <p className="text-xs text-muted">
          They must sign in with this exact email to accept.
        </p>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Pending invites
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="flex-1 truncate">
                  {i.email}
                  <span className="ml-2 text-xs text-muted">
                    {ROLE_LABELS[i.role]}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copy(i.token)}
                >
                  {copied === i.token ? <Check size={14} /> : <Copy size={14} />}
                  {copied === i.token ? "Copied" : "Copy link"}
                </Button>
                <button
                  className="text-muted hover:text-danger"
                  title="Revoke invite"
                  disabled={pending}
                  onClick={() => run(() => deleteInvite(i.id, campaignId))}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
