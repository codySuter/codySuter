import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

function fresh() {
  return convexTest(schema, modules);
}

describe("seed", () => {
  it("creates both starter worlds exactly once", async () => {
    const t = fresh();
    const first = await t.mutation(api.seed.init, {});
    expect(first.seeded).toBe(true);
    const again = await t.mutation(api.seed.init, {});
    expect(again.seeded).toBe(false);

    const workspaces = await t.query(api.workspaces.list, {});
    expect(workspaces).toHaveLength(2);
    expect(workspaces.map((w) => w.mode).sort()).toEqual(["daggerheart", "dnd5e"]);

    const status = await t.query(api.seed.status, {});
    expect(status.seeded).toBe(true);
    expect(status.workspaceCount).toBe(2);
  });

  it("seeds a page tree with content, databases, and backlinks", async () => {
    const t = fresh();
    await t.mutation(api.seed.init, {});
    const [dnd] = await t.query(api.workspaces.list, {});
    const tree = await t.query(api.pages.tree, { workspaceId: dnd._id });
    expect(tree.length).toBeGreaterThan(10);

    const hub = tree.find((p) => p.title.includes("Campaign Hub"))!;
    expect(hub).toBeDefined();
    const hubPage = await t.query(api.pages.get, { pageId: hub._id });
    expect(Array.isArray(hubPage!.content)).toBe(true);

    // The hub mentions the atlas — atlas should list the hub as a backlink.
    const atlas = tree.find((p) => p.title === "World Atlas")!;
    const backlinks = await t.query(api.pages.backlinks, {
      targetType: "page",
      targetId: atlas._id,
    });
    expect(backlinks.some((l) => l.title.includes("Campaign Hub"))).toBe(true);

    // Databases have entries with relation cells that create entry backlinks.
    const characters = tree.find((p) => p.title === "Characters")!;
    const rows = await t.query(api.entries.listByDatabase, { databaseId: characters._id });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const maera = rows.find((r) => r.title.startsWith("Maera"))!;
    const maeraBacklinks = await t.query(api.pages.backlinks, {
      targetType: "entry",
      targetId: maera._id,
    });
    expect(maeraBacklinks.length).toBeGreaterThan(0);
  });
});

describe("pages", () => {
  it("supports create/rename/move/trash/restore round trip", async () => {
    const t = fresh();
    const wsId = await t.mutation(api.workspaces.create, {
      name: "Test",
      mode: "dnd5e",
      icon: "🧪",
    });
    const parent = await t.mutation(api.pages.create, {
      workspaceId: wsId,
      type: "doc",
      title: "Parent",
    });
    const child = await t.mutation(api.pages.create, {
      workspaceId: wsId,
      parentId: parent,
      type: "doc",
      title: "Child",
    });
    await t.mutation(api.pages.rename, { pageId: child, title: "Renamed Child" });

    let tree = await t.query(api.pages.tree, { workspaceId: wsId });
    expect(tree).toHaveLength(2);
    expect(tree.find((p) => p._id === child)!.title).toBe("Renamed Child");

    // Trash the parent — the child goes too.
    await t.mutation(api.pages.moveToTrash, { pageId: parent });
    tree = await t.query(api.pages.tree, { workspaceId: wsId });
    expect(tree).toHaveLength(0);
    const trash = await t.query(api.pages.trashList, { workspaceId: wsId });
    expect(trash).toHaveLength(1);
    expect(trash[0]._id).toBe(parent);

    await t.mutation(api.pages.restore, { pageId: parent });
    tree = await t.query(api.pages.tree, { workspaceId: wsId });
    expect(tree).toHaveLength(2);
  });

  it("rejects cyclic moves", async () => {
    const t = fresh();
    const wsId = await t.mutation(api.workspaces.create, { name: "T", mode: "daggerheart", icon: "x" });
    const a = await t.mutation(api.pages.create, { workspaceId: wsId, type: "doc", title: "A" });
    const b = await t.mutation(api.pages.create, { workspaceId: wsId, parentId: a, type: "doc", title: "B" });
    await t.mutation(api.pages.move, { pageId: a, parentId: b, sortOrder: 1 });
    const tree = await t.query(api.pages.tree, { workspaceId: wsId });
    expect(tree.find((p) => p._id === a)!.parentId).toBeNull();
  });

  it("updates content and recomputes mention links", async () => {
    const t = fresh();
    const wsId = await t.mutation(api.workspaces.create, { name: "T", mode: "dnd5e", icon: "x" });
    const target = await t.mutation(api.pages.create, { workspaceId: wsId, type: "doc", title: "Target" });
    const source = await t.mutation(api.pages.create, { workspaceId: wsId, type: "doc", title: "Source" });
    const contentWithMention = [
      {
        id: "blk1",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "See ", styles: {} },
          { type: "mention", props: { targetType: "page", targetId: target, label: "Target", icon: "" } },
        ],
        children: [],
      },
    ];
    await t.mutation(api.pages.updateContent, { pageId: source, content: contentWithMention });
    let backlinks = await t.query(api.pages.backlinks, { targetType: "page", targetId: target });
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].title).toBe("Source");

    // Removing the mention clears the backlink.
    await t.mutation(api.pages.updateContent, {
      pageId: source,
      content: [{ id: "blk1", type: "paragraph", props: {}, content: [], children: [] }],
    });
    backlinks = await t.query(api.pages.backlinks, { targetType: "page", targetId: target });
    expect(backlinks).toHaveLength(0);
  });

  it("searches titles", async () => {
    const t = fresh();
    await t.mutation(api.seed.init, {});
    const [dnd] = await t.query(api.workspaces.list, {});
    const results = await t.query(api.search.all, { workspaceId: dnd._id, q: "Sepulcher" });
    expect(results.pages.some((p) => p.title.includes("Sepulcher"))).toBe(true);
    const characterHits = await t.query(api.search.all, { workspaceId: dnd._id, q: "Maera" });
    expect(characterHits.entries.some((e) => e.title.includes("Maera"))).toBe(true);
  });
});

describe("entries", () => {
  it("creates entries, patches cells, syncs relation backlinks", async () => {
    const t = fresh();
    const wsId = await t.mutation(api.workspaces.create, { name: "T", mode: "dnd5e", icon: "x" });
    const place = await t.mutation(api.pages.create, { workspaceId: wsId, type: "doc", title: "Place" });
    const db = await t.mutation(api.pages.create, {
      workspaceId: wsId,
      type: "db",
      title: "NPCs",
      props: [
        { id: "home", name: "Home", type: "relation" },
        { id: "status", name: "Status", type: "select", options: [{ id: "ok", label: "OK", color: "green" }] },
      ],
      views: [{ id: "v1", name: "Table", kind: "table" }],
    });
    const row = await t.mutation(api.entries.create, {
      databaseId: db,
      workspaceId: wsId,
      title: "Bob",
    });
    await t.mutation(api.entries.setCell, {
      entryId: row,
      propId: "home",
      value: [{ type: "page", id: place, title: "Place", icon: "" }],
    });
    const backlinks = await t.query(api.pages.backlinks, { targetType: "page", targetId: place });
    expect(backlinks.some((l) => l.fromType === "entry" && l.title === "Bob")).toBe(true);

    await t.mutation(api.entries.setCell, { entryId: row, propId: "home", value: null });
    const after = await t.query(api.pages.backlinks, { targetType: "page", targetId: place });
    expect(after).toHaveLength(0);

    await t.mutation(api.entries.remove, { entryId: row });
    const rows = await t.query(api.entries.listByDatabase, { databaseId: db });
    expect(rows).toHaveLength(0);
  });
});

describe("rolls", () => {
  it("logs and lists rolls", async () => {
    const t = fresh();
    const wsId = await t.mutation(api.workspaces.create, { name: "T", mode: "daggerheart", icon: "x" });
    await t.mutation(api.rolls.log, {
      workspaceId: wsId,
      expression: "2d12",
      kind: "duality",
      total: 17,
      detail: { hope: 9, fear: 8 },
      outcome: "hope",
    });
    const rolls = await t.query(api.rolls.list, { workspaceId: wsId });
    expect(rolls).toHaveLength(1);
    expect(rolls[0].outcome).toBe("hope");
  });
});
