# Campaign Codex

> **Also in this repo:**
> [`loreforge/`](loreforge/) — Loreforge, a TTRPG worldbuilding desktop app ·
> [`ace-document-studio/`](ace-document-studio/) — **Ace Document Studio**
> (formerly Ace Policy Studio), a Windows app for designing Snyder's Ace
> Hardware policy, procedure & store documents
> ([download the .exe](https://github.com/codysuter/codysuter/releases/download/ace-document-studio-windows/AceDocumentStudio.exe)).

A private wiki + database for your D&D world — NPCs, monsters, locations, shops,
magic items, session notes, maps, and player characters — all in one place,
reachable from anywhere.

- **You and your co-DM** get full edit access.
- **Players** get a read-only view, and only see the pages you explicitly
  reveal. Pages are hidden from players by default.
- **Quick templates**: hit **New** (or `⌘/Ctrl + K`) and pick "NPC", "Location",
  "Shop"… to spin up a pre-filled page in a second — built for fast, improvised
  play.
- **Wiki links**: type `[[` inside any page to link to another entry. Links
  survive renames and power a "Mentioned in" backlinks list.
- **DM-only secret blocks**: inside a page players *can* see, mark blocks as
  secret — they're stripped out for players, server-side.
- **Multiple worlds**: run separate campaigns, each with its own members.

---

## Tech stack

| Layer | Choice |
|------|--------|
| App | Next.js 16 (App Router, React 19) |
| Editor | Tiptap 3 (`[[ ]]` autocomplete + secret blocks) |
| Database / Auth / Storage | Supabase (Postgres + magic-link auth + private bucket) |
| Styling | Tailwind CSS v4 |
| Maps | `react-zoom-pan-pinch` |
| Hosting | Vercel + Supabase (both free tier) |

### How the permission model works (important)

The security boundary is **Postgres Row Level Security (RLS)** — *not* the UI.
A player querying a hidden NPC gets **zero rows back from the database**, even if
they bypass the app and call the API directly. See
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) for the
policies. Highlights:

- Membership + role (`dm` / `co_dm` / `player`) live per-campaign in
  `campaign_members`. `dm`/`co_dm` are "editors".
- `entries.visibility` defaults to `dm_only`. Players can only read rows where
  it's `players`.
- A `[[wiki link]]` to a hidden page renders as **inert plain text** for players
  — its id/href never reach the browser
  ([`lib/entries/render.tsx`](lib/entries/render.tsx)).
- DM-only secret blocks are dropped server-side before HTML is generated for a
  player.
- Map images live in a **private** Storage bucket and are served via short-lived
  signed URLs minted only after the row passes RLS.

---

## 1. Create your Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project
   (free tier is fine). Pick a strong database password.
2. In **Project Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)
3. Open the **SQL Editor**, paste the entire contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and
   **Run**. This creates every table, all RLS policies, the triggers, the
   invite-accept function, the private `maps` storage bucket, and seeds the
   built-in templates.
4. In **Authentication → Providers**, make sure **Email** is enabled (magic
   links work out of the box on the free tier).
5. In **Authentication → URL Configuration**, set:
   - **Site URL** → your deployed URL (e.g. `https://your-app.vercel.app`)
     (use `http://localhost:3000` while developing).
   - Add the same origin to **Redirect URLs** (e.g.
     `https://your-app.vercel.app/**`).

> Prefer the CLI? With the [Supabase CLI](https://supabase.com/docs/guides/cli):
> `supabase link --project-ref <ref>` then `supabase db push`.

## 2. Run it locally

```bash
cp .env.example .env.local      # then fill in the 4 values from step 1
npm install
npm run dev                     # http://localhost:3000
```

## 3. Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. In [Vercel](https://vercel.com), **Add New → Project**, import the repo.
   Next.js is auto-detected.
3. Add the four environment variables (**Settings → Environment Variables**):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (your Vercel URL).
4. Deploy. Update the Supabase **Site URL / Redirect URLs** (step 1.5) to the
   real Vercel domain.

## 4. Become the DM (one-time)

Roles are created via invites, but the very first user has to be promoted by
hand:

1. Open the app, sign in with your email (magic link).
2. Create your first campaign on the **Campaigns** page — **you automatically
   become its DM** (a database trigger handles this). Done!

That's it — creating a campaign makes you its DM. Use the **Members** page to
invite your co-DM (`Co-DM`) and players (`Player`) by email; share each generated
invite link. They sign in with that exact email to join.

---

## Using it

- **New entry**: `⌘/Ctrl + K` or the **New** button → choose a type. You land
  straight in the editor with the title focused.
- **Link pages**: type `[[`, search, pick a page — or "Create …" a new stub on
  the fly. Links update their text automatically if you rename the target.
- **Reveal to players**: open an entry and toggle **Hidden / Revealed** (or set
  it in the editor). Hidden is the default.
- **Secret blocks**: in the editor toolbar, the 👁 button wraps the selection in
  a DM-only block. Players never see it, even on a revealed page.
- **Maps**: create a **Map** entry and upload an image; everyone with access can
  pan/zoom it.
- **Character sheets**: create a **Player Character** entry and paste the D&D
  Beyond URL — it shows as a one-click link.

---

## Verifying the security model

After deploying, confirm players really can't see secrets (test the database,
not just the UI):

1. Create three test accounts (DM, Co-DM, Player) via the invite flow.
2. As DM, make entry **A** (Revealed) that links to entry **B** (Hidden).
3. Sign in as the **Player**:
   - Visiting **B**'s URL → 404.
   - On **A**, the link to **B** is plain grey text; view source — **B**'s id and
     title are absent.
   - Any DM-only secret block on **A** is gone.
4. (Optional, strongest check) Grab the player's access token from the browser
   and hit the REST API directly:
   `GET /rest/v1/entries?id=eq.<B-id>` → returns `[]`.
5. In Supabase, run **Advisors → Security** — every table should have RLS
   enabled with no warnings.

---

## Good to know

- **Free-tier pause**: Supabase pauses a free project after ~7 days of *no*
  activity (data is kept; resume with one click from the dashboard). For a group
  that plays regularly this is rarely an issue; upgrade to Pro for always-on.
- **Storage**: the free tier gives 1 GB — compress very large battle maps.

## Roadmap (not yet built)

- Clickable **map pins** linking spots to location pages (schema + actions are
  already in place).
- Full-text **search** across entries.
- In-app **custom entry types** editor.
- Realtime co-editing / presence.
