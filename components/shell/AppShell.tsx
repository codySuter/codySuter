"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Command } from "cmdk";
import { ScrollText, Plus, Home, BookOpen, Users, LogOut } from "lucide-react";
import { createEntry } from "@/actions/entries";
import { signOut } from "@/actions/auth";
import { TypeIcon } from "@/components/icon";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface TypeLite {
  key: string;
  label: string;
  icon: string | null;
}

export function AppShell({
  campaignId,
  campaignName,
  role,
  isEditor,
  entryTypes,
  children,
}: {
  campaignId: string;
  campaignName: string;
  role: AppRole;
  isEditor: boolean;
  entryTypes: TypeLite[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!isEditor) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEditor]);

  const create = (key: string) => {
    setOpen(false);
    startTransition(() => {
      void createEntry(campaignId, key);
    });
  };

  const base = `/c/${campaignId}`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <Link
            href={base}
            className="flex items-center gap-2 font-serif text-lg font-semibold"
          >
            <ScrollText className="text-primary" size={20} />
            <span className="max-w-[40vw] truncate">{campaignName}</span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              href={base}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <Home size={15} /> <span className="hidden sm:inline">Home</span>
            </Link>
            <Link
              href={`${base}/entries`}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <BookOpen size={15} />{" "}
              <span className="hidden sm:inline">Entries</span>
            </Link>
            {isEditor && (
              <Link
                href={`${base}/members`}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-text"
              >
                <Users size={15} />{" "}
                <span className="hidden sm:inline">Members</span>
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {isEditor && (
              <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                <Plus size={15} />
                <span className="hidden sm:inline">New</span>
              </Button>
            )}
            <span className="hidden rounded bg-surface-2 px-2 py-1 text-xs text-muted md:inline">
              {ROLE_LABELS[role]}
            </span>
            <form action={signOut}>
              <Button variant="ghost" size="icon" type="submit" title="Sign out">
                <LogOut size={16} />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8">{children}</main>

      {isEditor && (
        <Command.Dialog
          open={open}
          onOpenChange={setOpen}
          label="Quick create"
          overlayClassName="fixed inset-0 z-50 bg-black/50"
          contentClassName="fixed left-1/2 top-[18%] z-50 w-full max-w-md -translate-x-1/2 rounded-xl border border-line bg-surface shadow-2xl"
        >
          <Command.Input
            placeholder="Create new…  (NPC, location, shop…)"
            className="w-full border-b border-line bg-transparent px-4 py-3 text-sm focus:outline-none"
          />
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="px-2 py-3 text-sm text-muted">
              No matching type.
            </Command.Empty>
            {entryTypes.map((t) => (
              <Command.Item
                key={t.key}
                value={t.label}
                onSelect={() => create(t.key)}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted data-[selected=true]:bg-primary/20 data-[selected=true]:text-text"
              >
                <TypeIcon name={t.icon} size={16} />
                New {t.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command.Dialog>
      )}
    </div>
  );
}
