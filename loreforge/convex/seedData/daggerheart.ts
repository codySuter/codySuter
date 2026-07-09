import type { MutationCtx } from "../_generated/server";
import {
  p, h, quote, bullet, num, check, toggle, divider, table, callout,
  adversary, rollTable, tracker, abilityCard, encounter, timeline, mapBlock,
  t, b, i, mention, dice, uid,
} from "./builders";
import { addPage, setContent, addEntry, rel, rels } from "./helpers";

/** Seed the Daggerheart starter world: The Withered Vale. */
export async function seedDaggerheart(ctx: MutationCtx) {
  const ws = await ctx.db.insert("workspaces", {
    name: "The Withered Vale",
    mode: "daggerheart" as const,
    icon: "🌙",
    tagline: "Hope is a fire. Keep it fed — Daggerheart",
    sortOrder: 2000,
  });

  // ---- page skeleton ----
  const frame = await addPage(ctx, ws, { title: "Campaign Frame", icon: "✨", coverKey: "veil", isFavorite: true, sortOrder: 1000 });
  const atlas = await addPage(ctx, ws, { title: "Atlas of the Vale", icon: "🗺️", coverKey: "forest", sortOrder: 2000 });
  const hollowmere = await addPage(ctx, ws, { parentId: atlas, title: "Hollowmere", icon: "🏘️", sortOrder: 1000 });
  const wither = await addPage(ctx, ws, { parentId: atlas, title: "The Wither", icon: "🌫️", sortOrder: 2000 });
  const spire = await addPage(ctx, ws, { parentId: atlas, title: "Starfall Spire", icon: "🗼", coverKey: "night", sortOrder: 3000 });

  const castProps = [
    { id: "type", name: "Type", type: "select", options: [
      { id: "pc", label: "PC", color: "green" },
      { id: "npc", label: "NPC", color: "blue" },
    ]},
    { id: "heritage", name: "Heritage", type: "text" },
    { id: "class", name: "Class / Calling", type: "text" },
    { id: "domains", name: "Domains", type: "multiSelect", options: [
      { id: "arcana", label: "Arcana", color: "violet" },
      { id: "blade", label: "Blade", color: "red" },
      { id: "bone", label: "Bone", color: "gray" },
      { id: "codex", label: "Codex", color: "blue" },
      { id: "grace", label: "Grace", color: "pink" },
      { id: "midnight", label: "Midnight", color: "violet" },
      { id: "sage", label: "Sage", color: "green" },
      { id: "splendor", label: "Splendor", color: "amber" },
      { id: "valor", label: "Valor", color: "orange" },
    ]},
    { id: "connection", name: "Connection", type: "relation" },
  ];
  const cast = await addPage(ctx, ws, {
    type: "db", title: "Cast & Company", icon: "👥", sortOrder: 3000,
    props: castProps,
    views: [
      { id: uid(), name: "Everyone", kind: "table" },
      { id: uid(), name: "By Type", kind: "board", groupBy: "type" },
    ],
  });

  const advProps = [
    { id: "tier", name: "Tier", type: "select", options: [
      { id: "t1", label: "Tier 1", color: "green" },
      { id: "t2", label: "Tier 2", color: "amber" },
      { id: "t3", label: "Tier 3", color: "orange" },
      { id: "t4", label: "Tier 4", color: "red" },
    ]},
    { id: "role", name: "Role", type: "select", options: [
      { id: "bruiser", label: "Bruiser", color: "red" },
      { id: "horde", label: "Horde", color: "orange" },
      { id: "leader", label: "Leader", color: "violet" },
      { id: "lurker", label: "Lurker", color: "gray" },
      { id: "minion", label: "Minion", color: "blue" },
      { id: "ranged", label: "Ranged", color: "teal" },
      { id: "solo", label: "Solo", color: "amber" },
      { id: "environment", label: "Environment", color: "green" },
    ]},
    { id: "difficulty", name: "Difficulty", type: "number" },
    { id: "habitat", name: "Where", type: "relation" },
  ];
  const adversaries = await addPage(ctx, ws, {
    type: "db", title: "Adversary Codex", icon: "⚔️", sortOrder: 4000,
    props: advProps,
    views: [
      { id: uid(), name: "All Adversaries", kind: "table" },
      { id: uid(), name: "Cards", kind: "gallery" },
    ],
  });

  const threadProps = [
    { id: "status", name: "Status", type: "select", options: [
      { id: "whisper", label: "Whisper", color: "gray" },
      { id: "kindling", label: "Kindling", color: "blue" },
      { id: "blazing", label: "Blazing", color: "amber" },
      { id: "resolved", label: "Resolved", color: "green" },
    ]},
    { id: "who", name: "Who's Involved", type: "relation" },
    { id: "where", name: "Where", type: "relation" },
    { id: "stakes", name: "Stakes", type: "text" },
  ];
  const threads = await addPage(ctx, ws, {
    type: "db", title: "Story Threads", icon: "📜", sortOrder: 5000,
    props: threadProps,
    views: [
      { id: uid(), name: "Board", kind: "board", groupBy: "status" },
      { id: uid(), name: "All Threads", kind: "table" },
    ],
  });

  const domainProps = [
    { id: "domain", name: "Domain", type: "select", options: [
      { id: "arcana", label: "Arcana", color: "violet" },
      { id: "blade", label: "Blade", color: "red" },
      { id: "bone", label: "Bone", color: "gray" },
      { id: "codex", label: "Codex", color: "blue" },
      { id: "grace", label: "Grace", color: "pink" },
      { id: "midnight", label: "Midnight", color: "violet" },
      { id: "sage", label: "Sage", color: "green" },
      { id: "splendor", label: "Splendor", color: "amber" },
      { id: "valor", label: "Valor", color: "orange" },
    ]},
    { id: "level", name: "Level", type: "number" },
    { id: "kind", name: "Kind", type: "select", options: [
      { id: "ability", label: "Ability", color: "blue" },
      { id: "spell", label: "Spell", color: "violet" },
    ]},
    { id: "recall", name: "Recall Cost", type: "number" },
  ];
  const domains = await addPage(ctx, ws, {
    type: "db", title: "Domain Compendium (Homebrew)", icon: "🌿", sortOrder: 6000,
    props: domainProps,
    views: [
      { id: uid(), name: "All Cards", kind: "table" },
      { id: uid(), name: "Card Gallery", kind: "gallery" },
    ],
  });

  const chronicle = await addPage(ctx, ws, { title: "Chronicle of the Vale", icon: "⌛", coverKey: "arcane", sortOrder: 7000 });
  const gmScreen = await addPage(ctx, ws, { title: "GM Screen", icon: "🎲", isFavorite: true, sortOrder: 8000 });
  const rules = await addPage(ctx, ws, { title: "Rules Reference", icon: "📖", sortOrder: 9000 });
  const duality = await addPage(ctx, ws, { parentId: rules, title: "Duality, Hope & Fear", icon: "🎭", sortOrder: 1000 });
  const downtime = await addPage(ctx, ws, { parentId: rules, title: "Rest & Downtime", icon: "🏕️", sortOrder: 2000 });

  // ---- entries ----
  const castRelIds = ["connection"];
  const odessa = await addEntry(ctx, ws, cast, castRelIds, {
    title: "Keeper Odessa Marrow", icon: "🕯️", sortOrder: 3000,
    cells: {
      type: "npc", heritage: "Loreborne Human", class: "Keeper of the Emberhearth",
      connection: rel("page", hollowmere, "Hollowmere", "🏘️"),
    },
    content: [
      p(["Keeper of the last great fire. Her ledger records every family's ration of flame — and lately, the entries are getting smaller. She will not say why aloud, but see ", mention("page", wither, "The Wither", "🌫️"), "."]),
      callout("fear", "If the Emberhearth gutters below half, Odessa will start trading things Hollowmere cannot afford to lose."),
    ],
  });
  const wren = await addEntry(ctx, ws, cast, castRelIds, {
    title: "Wren Ashvale", icon: "🏹", sortOrder: 1000,
    cells: {
      type: "pc", heritage: "Wildborne Faun", class: "Ranger (Beastbound)",
      domains: ["bone", "sage"],
      connection: rel("entry", odessa, "Keeper Odessa Marrow", "🕯️"),
    },
    content: [
      p([i("“The Vale remembers being green. So do I.”")]),
      tracker("Wren — Vitals", [
        { name: "Hit Points", kind: "hp", current: 6, max: 6 },
        { name: "Stress", kind: "stress", current: 1, max: 6 },
        { name: "Hope", kind: "hope", current: 3, max: 6 },
        { name: "Armor Slots", kind: "armor", current: 3, max: 3 },
      ]),
      h(3, "Experiences"),
      bullet([b("Raised by the Vale +2"), " — reading weather, woods, and wounded animals"]),
      bullet([b("Ember-courier +1"), " — running the fire-roads between hearths"]),
      h(3, "Notes"),
      p(["Companion: ", b("Sootfeather"), ", a one-eyed hawk who hates ", mention("entry", odessa, "Keeper Odessa Marrow", "🕯️"), " for reasons unknown."]),
    ],
  });
  const maro = await addEntry(ctx, ws, cast, castRelIds, {
    title: "Maro of the Emberhearth", icon: "🛡️", sortOrder: 2000,
    cells: {
      type: "pc", heritage: "Highborne Galapa", class: "Seraph (Winged Sentinel)",
      domains: ["splendor", "valor"],
      connection: rel("page", hollowmere, "Hollowmere", "🏘️"),
    },
    content: [
      p("Sworn to the fire, slow to anger, impossible to move. Maro's shell is scored with the names of everyone the Emberhearth has saved."),
      tracker("Maro — Vitals", [
        { name: "Hit Points", kind: "hp", current: 7, max: 7 },
        { name: "Stress", kind: "stress", current: 0, max: 6 },
        { name: "Hope", kind: "hope", current: 2, max: 6 },
        { name: "Armor Slots", kind: "armor", current: 4, max: 4 },
      ]),
    ],
  });
  const silaine = await addEntry(ctx, ws, cast, castRelIds, {
    title: "Silaine the Gray", icon: "🌫️", sortOrder: 4000,
    cells: {
      type: "npc", heritage: "Unknown", class: "Wanderer at the edge of the Wither",
      connection: rel("page", wither, "The Wither", "🌫️"),
    },
    content: [
      p("She walks out of the gray unharmed, sells impossible salvage, and always pays her tab in old coin. The Wither parts around her like a curtain."),
      callout("dm", ["Truth: Silaine brokered the ", b("Broken Bargain"), " — see the ", mention("page", chronicle, "Chronicle of the Vale", "⌛"), ". She is not evil. She is amortizing."]),
    ],
  });
  const tobin = await addEntry(ctx, ws, cast, castRelIds, {
    title: "Tobin Merrow", icon: "🛶", sortOrder: 5000,
    cells: {
      type: "npc", heritage: "Ridgeborne Human", class: "Ferryman of the Mistlake",
      connection: rel("page", hollowmere, "Hollowmere", "🏘️"),
    },
    content: [p("Knows every safe channel through the mist — and charges accordingly. Superstitious, generous, and in debt to Silaine.")],
  });

  const advRelIds = ["habitat"];
  const stag = await addEntry(ctx, ws, adversaries, advRelIds, {
    title: "Wither-Touched Stag", icon: "🦌", sortOrder: 1000,
    cells: { tier: "t1", role: "bruiser", difficulty: 11, habitat: rel("page", wither, "The Wither", "🌫️") },
    content: [
      adversary({
        name: "Wither-Touched Stag",
        tier: 1, role: "Bruiser",
        description: "A great gray stag with antlers of petrified wood and eyes like fogged glass. It does not graze anymore.",
        motives: "Drive the living from the gray, protect the heart-tree, obey the hum",
        difficulty: 11, thresholds: "7/13", hp: 7, stress: 3,
        atk: "+2", weapon: "Gore", range: "Melee", damage: "1d8+3 phy",
        experience: "Silent Passage +2",
        features: [
          { name: "Gray Charge", type: "Action", text: "Move up to Far range in a straight line and make an attack. On a success, the target is knocked back to Close range and marks 1 Stress." },
          { name: "Withering Breath", type: "Action (Fear)", text: "Spend a Fear: every creature within Very Close range must succeed on an Instinct Reaction (14) or become Vulnerable until they next clear Stress." },
          { name: "Part of the Gray", type: "Passive", text: "While inside the Wither, the stag ignores the first Severe damage it would take each scene." },
        ],
      }),
    ],
  });
  const cantor = await addEntry(ctx, ws, adversaries, advRelIds, {
    title: "Gray Choir Cantor", icon: "🎶", sortOrder: 2000,
    cells: { tier: "t2", role: "leader", difficulty: 14, habitat: rel("page", spire, "Starfall Spire", "🗼") },
    content: [
      adversary({
        name: "Gray Choir Cantor",
        tier: 2, role: "Leader",
        description: "A robed figure whose hood holds only humming mist. It conducts the Wither like an orchestra.",
        motives: "Finish the song, collect what is owed, unmake loudly",
        difficulty: 14, thresholds: "10/20", hp: 8, stress: 4,
        atk: "+3", weapon: "Discordant Note", range: "Far", damage: "2d8+2 mag",
        experience: "The Old Music +3",
        features: [
          { name: "Choir of One", type: "Passive", text: "The Cantor acts twice when spotlighted if any other Gray Choir adversary is in the scene." },
          { name: "Crescendo", type: "Action (Fear)", text: "Spend 2 Fear: all mist within Far range thickens. Until the next PC rolls with Hope, adversaries in the mist gain +2 to attack rolls." },
          { name: "Final Measure", type: "Reaction", text: "When reduced to 0 HP, the Cantor dissolves into the mist — mark 1 Fear as its song continues somewhere else." },
        ],
      }),
    ],
  });
  await addEntry(ctx, ws, adversaries, advRelIds, {
    title: "Mistcap Swarm", icon: "🍄", sortOrder: 3000,
    cells: { tier: "t1", role: "horde", difficulty: 10, habitat: rel("page", wither, "The Wither", "🌫️") },
    content: [p("Knee-high fungal things that move like weather. Individually harmless; collectively a tide with teeth.")],
  });
  const mist = await addEntry(ctx, ws, adversaries, advRelIds, {
    title: "The Hollowing Mist", icon: "🌫️", sortOrder: 4000,
    cells: { tier: "t2", role: "environment", difficulty: 13, habitat: rel("page", wither, "The Wither", "🌫️") },
    content: [
      adversary({
        name: "The Hollowing Mist",
        tier: 2, role: "Environment",
        description: "The Wither's leading edge — a slow gray tide that drinks color, sound, and eventually names.",
        motives: "Spread, hush, hollow",
        difficulty: 13, thresholds: "—", hp: 0, stress: 0,
        features: [
          { name: "Hush", type: "Passive", text: "Inside the mist, all communication beyond Very Close range fails. Rally and help dice cost 1 additional Hope." },
          { name: "Drink Color", type: "Action (Fear)", text: "Spend a Fear: a PC in the mist marks a Stress and describes one small, precious memory going gray." },
          { name: "The Way Out", type: "Passive", text: "A PC may make an Instinct Roll (13) to lead the group toward clean air. With Fear, they exit — somewhere else." },
        ],
      }),
    ],
  });

  const threadRelIds = ["who", "where"];
  await addEntry(ctx, ws, threads, threadRelIds, {
    title: "The Dimming Emberhearth", icon: "🔥", sortOrder: 1000,
    cells: {
      status: "blazing", stakes: "Hollowmere's survival",
      who: rel("entry", odessa, "Keeper Odessa Marrow", "🕯️"),
      where: rel("page", hollowmere, "Hollowmere", "🏘️"),
    },
    content: [
      p("The great fire is shrinking an inch a week. Odessa's ledger says it shouldn't be. The Wither hasn't moved — something inside the walls is feeding on flame."),
      check("Find what's drinking the fire"),
      check("Keep the town from noticing before festival night"),
      check(["Ask ", mention("entry", silaine, "Silaine the Gray", "🌫️"), " what she knows (cost: unknown)"]),
    ],
  });
  await addEntry(ctx, ws, threads, threadRelIds, {
    title: "Silaine's Bargain", icon: "🤝", sortOrder: 2000,
    cells: {
      status: "whisper", stakes: "The truth of the Wither",
      who: rel("entry", silaine, "Silaine the Gray", "🌫️"),
      where: rel("page", wither, "The Wither", "🌫️"),
    },
    content: [p("Every debt in the Vale runs through her eventually. Whose debt made the Wither — and what would it cost to buy it back?")],
  });
  await addEntry(ctx, ws, threads, threadRelIds, {
    title: "The Ferry Toll", icon: "🛶", sortOrder: 3000,
    cells: {
      status: "kindling", stakes: "Safe passage across the Mistlake",
      who: rel("entry", tobin, "Tobin Merrow", "🛶"),
      where: rel("page", hollowmere, "Hollowmere", "🏘️"),
    },
    content: [p("Tobin owes Silaine three favors. She has called in the first: a sealed crate, delivered to the Spire by the dark of the moon, no questions.")],
  });
  await addEntry(ctx, ws, threads, threadRelIds, {
    title: "Songs from the Spire", icon: "🗼", sortOrder: 4000,
    cells: {
      status: "whisper", stakes: "Whatever the Choir is finishing",
      where: rel("page", spire, "Starfall Spire", "🗼"),
    },
    content: [p("On still nights the Spire hums a chord nobody can whistle back. The old astronomers' notes might name it — if anyone dares the climb.")],
  });
  await addEntry(ctx, ws, threads, threadRelIds, {
    title: "The First Flame Festival", icon: "🎆", sortOrder: 5000,
    cells: {
      status: "resolved", stakes: "Morale (and pie)",
      where: rel("page", hollowmere, "Hollowmere", "🏘️"),
    },
    content: [p("The party carried the new-lit lantern the whole circuit without it guttering. Hollowmere will be retelling this for a year. +1 Hope to everyone's opening scene next session.")],
  });

  await addEntry(ctx, ws, domains, [], {
    title: "Emberward", icon: "🕯️", sortOrder: 1000,
    cells: { domain: "splendor", level: 1, kind: "spell", recall: 1 },
    content: [
      abilityCard({
        name: "Emberward", kind: "Splendor · Level 1 Spell", subtitle: "Homebrew sample card",
        stats: [{ label: "Recall", value: "1" }],
        text: "Spend a Hope to wreathe an ally within Close range in warm light. Until your next rest, the first time they would mark HP from a magical source, they mark 1 fewer.",
        flavor: "The Emberhearth remembers everyone who has ever fed it.",
      }),
    ],
  });
  await addEntry(ctx, ws, domains, [], {
    title: "Gray Sight", icon: "👁️", sortOrder: 2000,
    cells: { domain: "midnight", level: 2, kind: "ability", recall: 1 },
    content: [
      abilityCard({
        name: "Gray Sight", kind: "Midnight · Level 2 Ability", subtitle: "Homebrew sample card",
        stats: [{ label: "Recall", value: "1" }],
        text: "Mark a Stress to see clearly through mist, smoke, and darkness until the end of the scene. While this lasts, you can hear the Wither's hum — and things inside it can hear you listening.",
      }),
    ],
  });
  await addEntry(ctx, ws, domains, [], {
    title: "Rootbind", icon: "🌱", sortOrder: 3000,
    cells: { domain: "sage", level: 1, kind: "spell", recall: 0 },
    content: [
      abilityCard({
        name: "Rootbind", kind: "Sage · Level 1 Spell", subtitle: "Homebrew sample card",
        stats: [{ label: "Recall", value: "0" }],
        text: "Make a Spellcast Roll against a target within Far range. On a success, roots grip them: they're Restrained until they break free with a Strength Roll (12) or take Severe damage.",
      }),
    ],
  });
  await addEntry(ctx, ws, domains, [], {
    title: "Blade of Consequence", icon: "⚔️", sortOrder: 4000,
    cells: { domain: "blade", level: 3, kind: "ability", recall: 2 },
    content: [
      abilityCard({
        name: "Blade of Consequence", kind: "Blade · Level 3 Ability", subtitle: "Homebrew sample card",
        stats: [{ label: "Recall", value: "2" }],
        text: "When you roll with Fear on an attack, you may mark a Stress to reroll your damage dice and keep the higher total. If you do, the GM gains a Fear anyway. Some prices are worth paying.",
      }),
    ],
  });

  // ---- page contents ----
  await setContent(ctx, ws, frame, [
    quote("The Vale was promised to the green, once. Then somebody broke a promise, and the gray came to collect."),
    h(2, "The pitch"),
    p(["A slow gray blight — ", mention("page", wither, "The Wither", "🌫️"), " — is drinking the color out of a once-verdant valley. The last town, ", mention("page", hollowmere, "Hollowmere", "🏘️"), ", survives around a great communal fire. The party are its wardens, its foragers, and eventually, its negotiators with whatever the Wither actually is."]),
    h(2, "Tone & themes"),
    bullet([b("Perilous hope"), " — the world is dimming, and every point of Hope spent means something."]),
    bullet([b("Community as character"), " — Hollowmere's fire is the party's true hit points."]),
    bullet([b("Debt and bargains"), " — everything gray was purchased. Every purchase can be renegotiated."]),
    h(2, "The Six Truths of the Vale"),
    num("The Wither is not weather. It keeps accounts."),
    num("Fire pushes it back; song draws it close."),
    num(["No one who walks into the gray comes back — except ", mention("entry", silaine, "Silaine the Gray", "🌫️"), "."]),
    num("The Emberhearth has never gone out. (Truth-ish. See Odessa's ledger.)"),
    num(["The ", mention("page", spire, "Starfall Spire", "🗼"), " predates the Vale, the Wither, and possibly the sky."]),
    num("Hope is not a metaphor here. The Vale spends it too."),
    h(2, "Session zero"),
    toggle("Questions for the table", [
      bullet("What does your character owe, and to whom?"),
      bullet("What color would the Wither take from you first?"),
      bullet("Who in Hollowmere knows your name — and which version of it?"),
    ]),
    toggle("Table agreements", [
      check("Lines & veils reviewed", true),
      check("Duality dice etiquette: table reads Hope/Fear together", true),
      check("Fear tokens visible to all (dread is a shared resource)"),
    ]),
    callout("hope", ["Roll it now for luck: ", dice("2d12", "Duality roll"), " — in Daggerheart you roll Hope & Fear dice together; the higher die colors the outcome. Doubles crit."]),
  ]);

  await setContent(ctx, ws, atlas, [
    p("The Vale, from the Mistlake to the gray line. The Wither's edge is re-surveyed every festival; the pins below are current as of last moon."),
    mapBlock("The Withered Vale", [
      { x: 38, y: 55, label: "Hollowmere", color: "gold", targetType: "page", targetId: hollowmere },
      { x: 66, y: 34, label: "Starfall Spire", color: "violet", targetType: "page", targetId: spire },
      { x: 22, y: 25, label: "The Wither (leading edge)", color: "gray", targetType: "page", targetId: wither },
      { x: 55, y: 72, label: "Mistlake ferry", color: "teal" },
    ]),
    rollTable({
      title: "Travel Omens",
      die: "d6",
      rows: [
        { min: 1, max: 2, text: "A ribbon of unwithered wildflowers, blooming in a perfect line. Following it is a choice." },
        { min: 3, max: 4, text: "Tobin's ferry bell, heard from entirely the wrong direction." },
        { min: 5, max: 5, text: "A patch of gray no bigger than a blanket, far from the Wither. New." },
        { min: 6, max: 6, text: "Birdsong. Nobody has heard birdsong in the Vale for three years." },
      ],
    }),
  ]);

  await setContent(ctx, ws, hollowmere, [
    p([i("Population 611. Fires lit: one, always.")]),
    p(["Hollowmere curls around the ", b("Emberhearth"), " like a hand around a match. Its keeper, ", mention("entry", odessa, "Keeper Odessa Marrow", "🕯️"), ", rations flame the way other towns ration grain. The ferryman ", mention("entry", tobin, "Tobin Merrow", "🛶"), " is the only regular way across the Mistlake."]),
    h(2, "Places that matter"),
    table(["Place", "Who", "Why"], [
      ["The Emberhearth", [mention("entry", odessa, "Keeper Odessa Marrow", "🕯️")], "The fire that keeps the gray out. Currently: dimming."],
      ["Merrow's Landing", [mention("entry", tobin, "Tobin Merrow", "🛶")], "Ferry, gossip, and cargo of dubious provenance"],
      ["The Gray Market", [mention("entry", silaine, "Silaine the Gray", "🌫️")], "Appears when she does. Sells salvage from inside the Wither."],
    ]),
    callout("quest", ["Active thread: ", b("The Dimming Emberhearth"), " — see the ", mention("page", threads, "Story Threads", "📜"), " board."]),
  ]);

  await setContent(ctx, ws, wither, [
    p(["The gray is not fog. Fog moves with the wind; the Wither moves with ", b("intent"), ". Inside, color fades first, then sound, then — for those who stay — the habit of having a name."]),
    callout("fear", ["GM: when the party sleeps within sight of the gray line, gain a Fear. When they burn something precious to push it back, they gain a Hope — the Vale keeps accounts ", i("both ways"), "."]),
    h(2, "Zones of the gray"),
    bullet([b("The Hem"), " (minutes in) — colors dull, sounds flatten. Safe-ish with fire."]),
    bullet([b("The Weave"), " (hours in) — the ", mention("entry", mist, "The Hollowing Mist", "🌫️"), " environment rules apply. Navigation by Instinct only."]),
    bullet([b("The Loom"), " (days in) — unmapped. Silaine's salvage comes from here. So does the hum."]),
    h(2, "Denizens"),
    p([mention("entry", stag, "Wither-Touched Stag", "🦌"), " · Mistcap Swarms · the ", mention("entry", cantor, "Gray Choir Cantor", "🎶"), " conducting it all."]),
  ]);

  await setContent(ctx, ws, spire, [
    p(["A needle of star-metal older than any map, leaning two degrees off true. The astronomers who built their observatory around it are three centuries gone; their instruments still turn to follow something no one else can see. Lately the Spire ", b("hums back"), " at the Wither."]),
    h(2, "The climb"),
    toggle("Landing 1 — The Orrery Hall", [
      p("Brass planets on broken rails. One small moon still orbits, powered by nothing. It always faces the Wither."),
    ]),
    toggle("Landing 2 — The Silent Stacks", [
      p(["Star-charts, debt-ledgers (why?), and a visitors' book whose last signature is ", mention("entry", silaine, "Silaine the Gray", "🌫️"), " — dated three hundred years ago, in fresh ink."]),
      callout("lore", "The ledgers record payments to 'the Choir' in a currency column labeled simply: hue."),
    ]),
    toggle("Landing 3 — The Aperture", [
      p(["Open sky, a lens the size of a millstone, and a ", mention("entry", cantor, "Gray Choir Cantor", "🎶"), " rehearsing. The campaign's second act starts the moment the party interrupts."]),
    ]),
  ]);

  await setContent(ctx, ws, chronicle, [
    timeline("Chronicle of the Vale", [
      {
        name: "The Verdant Age", color: "green",
        events: [
          { date: "Long ago", title: "The Promise", text: "The valley is given to the green — by whom, in exchange for what, no record survives. The Spire predates even this.", targetType: "page", targetId: spire, targetLabel: "Starfall Spire" },
          { date: "~300 years past", title: "The Astronomers Vanish", text: "The Spire's scholars stop writing mid-sentence. Their last ledgers record payments in 'hue'." },
        ],
      },
      {
        name: "The Broken Bargain", color: "violet",
        events: [
          { date: "80 years past", title: "The Bargain Breaks", text: "Something owed is not paid. The first gray appears at the Vale's western rim — a patch no bigger than a blanket." },
          { date: "62 years past", title: "The Emberhearth Is Lit", text: "Hollowmere's founders discover fire holds the line, and build a town around a single flame.", targetType: "page", targetId: hollowmere, targetLabel: "Hollowmere" },
        ],
      },
      {
        name: "The Withering", color: "gray",
        events: [
          { date: "3 years past", title: "The Birds Go Quiet", text: "The last dawn chorus in the Vale. Nobody noticed until it was over." },
          { date: "This season", title: "The Fire Dims", text: "The Emberhearth begins shrinking despite full fuel. The campaign begins.", targetType: "page", targetId: hollowmere, targetLabel: "Hollowmere" },
        ],
      },
    ]),
  ]);

  await setContent(ctx, ws, gmScreen, [
    h(2, "The GM's economy"),
    tracker("Fear & Consequences", [
      { name: "Fear Pool", kind: "fear", current: 4, max: 12 },
      { name: "Emberhearth (inches left)", kind: "custom", current: 31, max: 40 },
      { name: "Wither advance (leagues)", kind: "custom", current: 2, max: 10 },
    ]),
    callout("fear", ["Spend Fear to: interrupt with an adversary action · make the environment act · add an adversary's Experience to a roll. Gain Fear when a PC rolls with Fear or rests within the gray's sight."]),
    h(2, "Spotlight tracker"),
    encounter("Gray line skirmish", [
      { name: "Wren", init: 0, hp: 6, maxHp: 6, isPC: true, note: "Duality — no initiative; pass the spotlight" },
      { name: "Maro", init: 0, hp: 7, maxHp: 7, isPC: true },
      { name: "Wither-Touched Stag", init: 0, hp: 7, maxHp: 7, note: "Thresholds 7/13" },
      { name: "Mistcap Swarm", init: 0, hp: 5, maxHp: 5, note: "Horde: damage halves when bloodied" },
    ], false),
    h(2, "Duality quick reference"),
    bullet(["Roll ", dice("2d12", "Duality"), " + trait. Higher die decides: ", b("Hope"), " → you gain a Hope; ", b("Fear"), " → GM gains a Fear. Doubles → ", b("critical success"), ": clear a Stress AND gain a Hope."]),
    bullet(["Advantage adds ", dice("1d6", "advantage"), " to the total; disadvantage subtracts it."]),
    bullet(["The dice tray (⌘J) has a dedicated ", b("Duality"), " button in this workspace."]),
    h(2, "Omens (spend a quiet moment)"),
    rollTable({
      title: "Omens of the Wither",
      die: "d12",
      rows: [
        { min: 1, max: 3, text: "A gray moth lands on someone's pack and will not leave." },
        { min: 4, max: 6, text: "Distant hum, three notes. The third is new." },
        { min: 7, max: 9, text: "A traveler's shrine, freshly tended — by whom, out here?" },
        { min: 10, max: 11, text: "Silaine, on the road, walking the other way. She tips her hat." },
        { min: 12, max: 12, text: "For one held breath, everything is in color again." },
      ],
    }),
    p(["Adversaries at hand: ", mention("entry", stag, "Wither-Touched Stag", "🦌"), " · ", mention("entry", cantor, "Gray Choir Cantor", "🎶"), " · ", mention("entry", mist, "The Hollowing Mist", "🌫️"), " — full codex in ", mention("page", adversaries, "Adversary Codex", "⚔️"), "."]),
  ]);

  await setContent(ctx, ws, rules, [
    p("Fast references for the table. Daggerheart runs on the fiction — these pages are the rails, not the train."),
    callout("note", ["Loreforge is unofficial Fan Content. Daggerheart™ is © Critical Role LLC / Darrington Press; summaries here are paraphrased for personal play under the Darrington Press Community Gaming License. Homebrew content is clearly marked."]),
  ]);

  await setContent(ctx, ws, duality, [
    h(2, "The duality roll"),
    num(["Roll ", b("2d12"), " — one Hope die, one Fear die — add your trait and any Experience."]),
    num(["Beat the Difficulty: you succeed. Then read the dice: ", b("higher Hope die"), " → success ", i("with Hope"), " (gain 1 Hope); ", b("higher Fear die"), " → success ", i("with Fear"), " (GM gains 1 Fear)."]),
    num([b("Doubles"), " → critical success: you also clear 1 Stress and gain 1 Hope."]),
    num(["Fail with Hope: a consolation — gain 1 Hope. Fail with Fear: the GM gains 1 Fear ", i("and"), " the spotlight."]),
    h(2, "Spending Hope"),
    bullet(["Help an ally (roll a ", dice("1d6", "help die"), " and add it to their roll)"]),
    bullet("Add an Experience to your roll (+its bonus)"),
    bullet("Power class features and abilities"),
    h(2, "Stress & damage"),
    bullet(["Mark ", b("Stress"), " to push yourself, resist consequences, or power certain features. At full Stress you're ", b("Vulnerable"), " and can't mark more."]),
    bullet(["Damage compares to your ", b("thresholds"), ": below Major = 1 HP; Major+ = 2 HP; Severe+ = 3 HP. Armor slots reduce a hit by one step."]),
    h(2, "Conditions"),
    table(["Condition", "Short version"], [
      [[b("Hidden")], "Unseen and unheard: rolls against you have disadvantage until you're spotted or you act loudly."],
      [[b("Restrained")], "You can't move, and can't do much else until you break free per the effect that pinned you."],
      [[b("Vulnerable")], "All rolls targeting you have advantage."],
    ]),
    callout("note", "Paraphrased quick reference for personal play — see the Daggerheart core rules for the real text."),
  ]);

  await setContent(ctx, ws, downtime, [
    h(2, "Short rest (choose 2, once each)"),
    bullet([b("Tend to Wounds"), " — clear ", dice("1d4", "HP"), " HP (yourself or an ally)"]),
    bullet([b("Clear Stress"), " — clear ", dice("1d4", "Stress"), " Stress"]),
    bullet([b("Repair Armor"), " — restore ", dice("1d4", "Armor"), " armor slots"]),
    bullet([b("Prepare"), " — describe how; gain a Hope (or two if you prepare with an ally)"]),
    h(2, "Long rest (choose 2, may repeat)"),
    bullet("Fully clear HP, Stress, or armor slots (pick one per choice)"),
    bullet("Work on a project — advance a long-term countdown"),
    bullet(["Gain a Hope — the Vale rewards those who rest ", i("together")]),
    callout("hope", "House rule of the Vale: resting within sight of the Emberhearth clears one extra Stress. Fire keeps more than the gray away."),
    callout("note", "Paraphrased quick reference for personal play — see the Daggerheart core rules for the real text."),
  ]);

  return ws;
}
