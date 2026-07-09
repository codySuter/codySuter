import type { MutationCtx } from "../_generated/server";
import {
  p, h, quote, bullet, num, check, toggle, divider, table, callout,
  statblock, adversary, rollTable, tracker, abilityCard, encounter, timeline, mapBlock,
  t, b, i, mention, dice, uid,
} from "./builders";
import { addPage, setContent, addEntry, rel, rels } from "./helpers";

/** Seed the D&D 5E (2024) starter world: Emberfall. */
export async function seedDnd(ctx: MutationCtx) {
  const ws = await ctx.db.insert("workspaces", {
    name: "Emberfall",
    mode: "dnd5e" as const,
    icon: "🔥",
    tagline: "A kingdom rebuilt on burning ruins — D&D 5E (2024)",
    sortOrder: 1000,
  });

  // ---- create the page skeleton first so mentions can reference real ids ----
  const hub = await addPage(ctx, ws, { title: "Emberfall — Campaign Hub", icon: "🏰", coverKey: "dragonfire", isFavorite: true, sortOrder: 1000 });
  const atlas = await addPage(ctx, ws, { title: "World Atlas", icon: "🗺️", coverKey: "parchment", sortOrder: 2000 });
  const veldrenn = await addPage(ctx, ws, { parentId: atlas, title: "The Kingdom of Veldrenn", icon: "👑", sortOrder: 1000 });
  const cinderwood = await addPage(ctx, ws, { parentId: atlas, title: "The Cinderwood", icon: "🌲", sortOrder: 2000 });
  const thornhollow = await addPage(ctx, ws, { parentId: atlas, title: "Thornhollow", icon: "🏘️", sortOrder: 3000 });
  const sepulcher = await addPage(ctx, ws, { parentId: atlas, title: "The Sunken Sepulcher", icon: "🕳️", coverKey: "dungeon", sortOrder: 4000 });

  // Databases
  const charProps = [
    { id: "role", name: "Role", type: "select", options: [
      { id: "pc", label: "Party", color: "green" },
      { id: "ally", label: "Ally", color: "blue" },
      { id: "neutral", label: "Neutral", color: "gray" },
      { id: "villain", label: "Villain", color: "red" },
    ]},
    { id: "occupation", name: "Occupation", type: "text" },
    { id: "location", name: "Location", type: "relation" },
    { id: "faction", name: "Faction", type: "relation" },
    { id: "status", name: "Status", type: "select", options: [
      { id: "alive", label: "Alive", color: "green" },
      { id: "missing", label: "Missing", color: "amber" },
      { id: "dead", label: "Dead", color: "gray" },
    ]},
  ];
  const characters = await addPage(ctx, ws, {
    type: "db", title: "Characters", icon: "👥", sortOrder: 3000,
    props: charProps,
    views: [
      { id: uid(), name: "All Characters", kind: "table" },
      { id: uid(), name: "By Role", kind: "board", groupBy: "role" },
      { id: uid(), name: "Portraits", kind: "gallery" },
    ],
  });

  const factionProps = [
    { id: "type", name: "Type", type: "select", options: [
      { id: "crown", label: "Crown", color: "amber" },
      { id: "guild", label: "Guild", color: "blue" },
      { id: "cult", label: "Cult", color: "red" },
      { id: "order", label: "Order", color: "teal" },
    ]},
    { id: "influence", name: "Influence", type: "number" },
    { id: "attitude", name: "Attitude", type: "select", options: [
      { id: "friendly", label: "Friendly", color: "green" },
      { id: "wary", label: "Wary", color: "amber" },
      { id: "hostile", label: "Hostile", color: "red" },
    ]},
    { id: "hq", name: "Headquarters", type: "relation" },
  ];
  const factions = await addPage(ctx, ws, {
    type: "db", title: "Factions & Guilds", icon: "🏛️", sortOrder: 4000,
    props: factionProps,
    views: [{ id: uid(), name: "All Factions", kind: "table" }],
  });

  const beastProps = [
    { id: "type", name: "Type", type: "select", options: [
      { id: "dragon", label: "Dragon", color: "red" },
      { id: "undead", label: "Undead", color: "violet" },
      { id: "elemental", label: "Elemental", color: "orange" },
      { id: "monstrosity", label: "Monstrosity", color: "green" },
      { id: "beast", label: "Beast", color: "teal" },
    ]},
    { id: "cr", name: "CR", type: "text" },
    { id: "habitat", name: "Habitat", type: "multiSelect", options: [
      { id: "forest", label: "Forest", color: "green" },
      { id: "ruins", label: "Ruins", color: "gray" },
      { id: "underground", label: "Underground", color: "violet" },
      { id: "urban", label: "Urban", color: "blue" },
    ]},
    { id: "threat", name: "Threat", type: "select", options: [
      { id: "low", label: "Low", color: "green" },
      { id: "moderate", label: "Moderate", color: "amber" },
      { id: "severe", label: "Severe", color: "orange" },
      { id: "deadly", label: "Deadly", color: "red" },
    ]},
  ];
  const bestiary = await addPage(ctx, ws, {
    type: "db", title: "Bestiary", icon: "🐲", sortOrder: 5000,
    props: beastProps,
    views: [
      { id: uid(), name: "All Creatures", kind: "table" },
      { id: uid(), name: "Cards", kind: "gallery" },
    ],
  });

  const questProps = [
    { id: "status", name: "Status", type: "select", options: [
      { id: "rumor", label: "Rumor", color: "gray" },
      { id: "active", label: "Active", color: "amber" },
      { id: "complete", label: "Complete", color: "green" },
      { id: "failed", label: "Failed", color: "red" },
    ]},
    { id: "giver", name: "Quest Giver", type: "relation" },
    { id: "location", name: "Location", type: "relation" },
    { id: "reward", name: "Reward", type: "text" },
    { id: "priority", name: "Priority", type: "select", options: [
      { id: "low", label: "Low", color: "gray" },
      { id: "med", label: "Medium", color: "blue" },
      { id: "high", label: "High", color: "red" },
    ]},
  ];
  const quests = await addPage(ctx, ws, {
    type: "db", title: "Quest Board", icon: "📜", sortOrder: 6000,
    props: questProps,
    views: [
      { id: uid(), name: "Board", kind: "board", groupBy: "status" },
      { id: uid(), name: "All Quests", kind: "table" },
    ],
  });

  const vaultProps = [
    { id: "rarity", name: "Rarity", type: "select", options: [
      { id: "common", label: "Common", color: "gray" },
      { id: "uncommon", label: "Uncommon", color: "green" },
      { id: "rare", label: "Rare", color: "blue" },
      { id: "veryrare", label: "Very Rare", color: "violet" },
      { id: "legendary", label: "Legendary", color: "amber" },
    ]},
    { id: "type", name: "Type", type: "select", options: [
      { id: "weapon", label: "Weapon", color: "red" },
      { id: "armor", label: "Armor", color: "blue" },
      { id: "wondrous", label: "Wondrous", color: "violet" },
      { id: "potion", label: "Potion", color: "green" },
    ]},
    { id: "attunement", name: "Attunement", type: "checkbox" },
    { id: "foundAt", name: "Found At", type: "relation" },
  ];
  const vault = await addPage(ctx, ws, {
    type: "db", title: "Vault of Wonders", icon: "✨", sortOrder: 7000,
    props: vaultProps,
    views: [
      { id: uid(), name: "All Items", kind: "table" },
      { id: uid(), name: "Gallery", kind: "gallery" },
    ],
  });

  const journal = await addPage(ctx, ws, { title: "Session Journal", icon: "🧾", sortOrder: 8000 });
  const session0 = await addPage(ctx, ws, { parentId: journal, title: "Session 0 — Sparks Over Thornhollow", icon: "🕯️", sortOrder: 1000 });
  const history = await addPage(ctx, ws, { title: "History of Emberfall", icon: "⌛", coverKey: "arcane", sortOrder: 9000 });
  const dmScreen = await addPage(ctx, ws, { title: "DM Screen", icon: "🎲", isFavorite: true, sortOrder: 10000 });
  const rules = await addPage(ctx, ws, { title: "Rules Reference", icon: "📖", sortOrder: 11000 });
  const conditions = await addPage(ctx, ws, { parentId: rules, title: "Conditions (2024)", icon: "🌀", sortOrder: 1000 });
  const combatSheet = await addPage(ctx, ws, { parentId: rules, title: "Combat Cheat Sheet", icon: "⚔️", sortOrder: 2000 });

  // ---- database entries ----
  const factionRelIds = ["hq"];
  const emberChoir = await addEntry(ctx, ws, factions, factionRelIds, {
    title: "The Ember Choir", icon: "🎶", sortOrder: 1000,
    cells: {
      type: "cult", influence: 7, attitude: "hostile",
      hq: rel("page", sepulcher, "The Sunken Sepulcher", "🕳️"),
    },
    content: [
      p([i("“The sky burned once. We will teach it to burn again.”")]),
      p(["A cult of ash-robed zealots who believe the Night of Falling Embers was a ", b("first verse"), ", not a catastrophe. They collect shards of the shattered sky-fortress and sing to them."]),
      callout("dm", ["Their true goal: reassemble the ", b("Crown of Cinders"), " and wake the ember-wyrm sleeping under the Cinderwood."]),
    ],
  });
  const wardens = await addEntry(ctx, ws, factions, factionRelIds, {
    title: "Wardens of the Vigil", icon: "🛡️", sortOrder: 2000,
    cells: { type: "order", influence: 5, attitude: "friendly", hq: rel("page", thornhollow, "Thornhollow", "🏘️") },
    content: [p("Veterans of the Ember Wars who keep the beacon-towers lit. Underfunded, overstretched, and quietly heroic.")],
  });
  const consortium = await addEntry(ctx, ws, factions, factionRelIds, {
    title: "Gilded Scale Consortium", icon: "🪙", sortOrder: 3000,
    cells: { type: "guild", influence: 8, attitude: "wary", hq: rel("page", veldrenn, "The Kingdom of Veldrenn", "👑") },
    content: [p("Merchant princes who own half the realm's debts — including, whispers say, the Crown's.")],
  });
  const crown = await addEntry(ctx, ws, factions, factionRelIds, {
    title: "The Crown of Veldrenn", icon: "👑", sortOrder: 4000,
    cells: { type: "crown", influence: 9, attitude: "friendly", hq: rel("page", veldrenn, "The Kingdom of Veldrenn", "👑") },
  });

  const charRelIds = ["location", "faction"];
  const maera = await addEntry(ctx, ws, characters, charRelIds, {
    title: "Maera Thistledown", icon: "🌿", sortOrder: 1000,
    cells: {
      role: "ally", occupation: "Apothecary & quest-giver", status: "alive",
      location: rel("page", thornhollow, "Thornhollow", "🏘️"),
      faction: rel("entry", wardens, "Wardens of the Vigil", "🛡️"),
    },
    content: [
      p(["A halfling apothecary with soot-stained fingers and an encyclopedic memory for poisons. Runs the ", b("Thistle & Thorn"), " shop off Thornhollow's market square."]),
      bullet(["Wants: ember-moth wings from ", mention("page", cinderwood, "The Cinderwood", "🌲"), " for a burn salve."]),
      bullet(["Fears: the coughing sickness spreading from the ", mention("page", sepulcher, "The Sunken Sepulcher", "🕳️"), "."]),
      callout("dm", "Maera was once the Ember Choir's poisoner. She keeps her old mask under the floorboards — and the Choir keeps her secret as leverage."),
    ],
  });
  const bram = await addEntry(ctx, ws, characters, charRelIds, {
    title: "Captain Bram Ironwood", icon: "🪓", sortOrder: 2000,
    cells: {
      role: "ally", occupation: "Captain of the Thornhollow Watch", status: "alive",
      location: rel("page", thornhollow, "Thornhollow", "🏘️"),
      faction: rel("entry", wardens, "Wardens of the Vigil", "🛡️"),
    },
    content: [p("A broad, tired man who says “not on my watch” and means it. Keeps a tally of every villager lost to the Wood on the back of his shield.")],
  });
  const serane = await addEntry(ctx, ws, characters, charRelIds, {
    title: "Queen Serane Veldrenn III", icon: "👸", sortOrder: 3000,
    cells: {
      role: "neutral", occupation: "Queen of Veldrenn", status: "alive",
      location: rel("page", veldrenn, "The Kingdom of Veldrenn", "👑"),
      faction: rel("entry", crown, "The Crown of Veldrenn", "👑"),
    },
    content: [p("Third of her name, crowned at fourteen amid the ashfall. Rules with a cartographer's precision and a widow's patience.")],
  });
  const vexil = await addEntry(ctx, ws, characters, charRelIds, {
    title: "Vexil “The Moth”", icon: "🦋", sortOrder: 4000,
    cells: {
      role: "neutral", occupation: "Information broker", status: "alive",
      location: rel("page", thornhollow, "Thornhollow", "🏘️"),
      faction: rel("entry", consortium, "Gilded Scale Consortium", "🪙"),
    },
    content: [p("Sells secrets by weight. Payment plans available; interest compounds unpleasantly.")],
  });
  const korvan = await addEntry(ctx, ws, characters, charRelIds, {
    title: "High Ashpriest Korvan", icon: "🔥", sortOrder: 5000,
    cells: {
      role: "villain", occupation: "Leader of the Ember Choir", status: "alive",
      location: rel("page", sepulcher, "The Sunken Sepulcher", "🕳️"),
      faction: rel("entry", emberChoir, "The Ember Choir", "🎶"),
    },
    content: [
      quote("“Grief is only love with nowhere to go. I gave mine to the fire.”"),
      p(["Once a beloved priest of the dawn, Korvan lost his family in the Night of Falling Embers and rebuilt his faith around the flame that took them. Charismatic, sincere, and utterly gone. Commands the ", mention("entry", emberChoir, "The Ember Choir", "🎶"), " from the drowned halls of the Sepulcher."]),
      callout("danger", ["In combat he opens with ", b("Ashen Chorus"), " (frightened aura) and burns legendary resistance to keep his concentration on it. Stat him as a war priest — see the ", mention("page", bestiary, "Bestiary", "🐲"), "."]),
    ],
  });
  const sira = await addEntry(ctx, ws, characters, charRelIds, {
    title: "Sira of the Ember Choir", icon: "🕯️", sortOrder: 6000,
    cells: {
      role: "villain", occupation: "Choir lieutenant, voice of the shards", status: "missing",
      faction: rel("entry", emberChoir, "The Ember Choir", "🎶"),
    },
    content: [p("The Choir's sweetest singer. Last seen buying passage upriver with a crate that hummed.")],
  });

  const beastRelIds: string[] = [];
  const wyrmling = await addEntry(ctx, ws, bestiary, beastRelIds, {
    title: "Ashvein Wyrmling", icon: "🐉", sortOrder: 1000,
    cells: { type: "dragon", cr: "2", habitat: ["forest", "ruins"], threat: "severe" },
    content: [
      p([i("A cat-sized dragon of cooling lava, veins glowing like a banked forge. Spawn of the thing sleeping under the Cinderwood.")]),
      statblock({
        name: "Ashvein Wyrmling",
        meta: "Small Dragon, Chaotic Evil",
        ac: "15", hp: "39", hpFormula: "6d8 + 12", speed: "30 ft., fly 50 ft.",
        str: 15, dex: 12, con: 14, int: 10, wis: 11, cha: 13,
        saves: "Dex +3, Con +4", skills: "Perception +2, Stealth +3",
        immunities: "Fire", vulnerabilities: "Cold",
        senses: "Blindsight 10 ft., Darkvision 60 ft., Passive Perception 12",
        languages: "Draconic", cr: "2 (XP 450; PB +2)",
        traits: [
          { name: "Ember Body", text: "A creature that touches the wyrmling or hits it with a melee attack while within 5 feet takes 2 (1d4) fire damage." },
          { name: "Smolder", text: "When the wyrmling dies, it collapses into a pile of embers that burns for 1 hour." },
        ],
        actions: [
          { name: "Rend", text: "Melee Attack Roll: +4, reach 5 ft. Hit: 7 (1d10 + 2) piercing damage plus 3 (1d6) fire damage." },
          { name: "Cinder Breath (Recharge 5–6)", text: "Dexterity Saving Throw: DC 12, each creature in a 15-foot cone. Failure: 17 (5d6) fire damage. Success: half damage." },
        ],
      }),
    ],
  });
  await addEntry(ctx, ws, bestiary, beastRelIds, {
    title: "Cinder Shrike", icon: "🐦", sortOrder: 2000,
    cells: { type: "beast", cr: "1/4", habitat: ["forest"], threat: "low" },
    content: [p("Crows that nested too close to the embers. They steal anything shiny and drop it, burning, on whatever annoys them.")],
  });
  const guardian = await addEntry(ctx, ws, bestiary, beastRelIds, {
    title: "Sepulcher Guardian", icon: "🗿", sortOrder: 3000,
    cells: { type: "undead", cr: "3", habitat: ["underground", "ruins"], threat: "severe" },
    content: [
      statblock({
        name: "Sepulcher Guardian",
        meta: "Medium Undead, Lawful Evil",
        ac: "16", hp: "52", hpFormula: "8d8 + 16", speed: "25 ft.",
        str: 18, dex: 8, con: 15, int: 6, wis: 12, cha: 7,
        saves: "Wis +3", resistances: "Bludgeoning, Piercing, Slashing (nonmagical)",
        immunities: "Poison; Frightened, Poisoned",
        senses: "Darkvision 60 ft., Passive Perception 11",
        languages: "Understands Common but can't speak", cr: "3 (XP 700; PB +2)",
        traits: [
          { name: "Tomb-Bound", text: "The guardian can't willingly move more than 100 feet from its sarcophagus." },
          { name: "Waterlogged Grasp", text: "A creature grappled by the guardian can't breathe unless it can breathe water." },
        ],
        actions: [
          { name: "Multiattack", text: "The guardian makes two Barnacled Fist attacks." },
          { name: "Barnacled Fist", text: "Melee Attack Roll: +6, reach 5 ft. Hit: 11 (2d6 + 4) bludgeoning damage, and the target is grappled (escape DC 14) if it is a Medium or smaller creature." },
        ],
      }),
    ],
  });
  await addEntry(ctx, ws, bestiary, beastRelIds, {
    title: "Emberling", icon: "🔥", sortOrder: 4000,
    cells: { type: "elemental", cr: "1/2", habitat: ["forest", "ruins"], threat: "moderate" },
    content: [p(["A knee-high flicker of living flame. Mostly curious, occasionally arsonous. Throw it a log and roll ", dice("1d20+3", "Animal Handling"), " to make a friend for life."])],
  });

  const questRelIds = ["giver", "location"];
  await addEntry(ctx, ws, quests, questRelIds, {
    title: "The Apothecary's Request", icon: "🧪", sortOrder: 1000,
    cells: {
      status: "active", priority: "high", reward: "50 gp + 3 potions of healing",
      giver: rel("entry", maera, "Maera Thistledown", "🌿"),
      location: rel("page", sepulcher, "The Sunken Sepulcher", "🕳️"),
    },
    content: [
      p(["Maera needs ", b("grave-lotus"), " that blooms only in the drowned halls of the Sepulcher — the source of the coughing sickness is down there too."]),
      check("Reach the Sunken Sepulcher", true),
      check("Harvest 3 grave-lotus blooms"),
      check("Discover what's poisoning the water"),
      check("Return to Maera before the next full moon"),
      callout("treasure", "The Choir left a shard-reliquary in the flooded chapel. It sings if you hold it to your ear."),
    ],
  });
  await addEntry(ctx, ws, quests, questRelIds, {
    title: "Embers in the Wood", icon: "🌲", sortOrder: 2000,
    cells: {
      status: "active", priority: "med", reward: "Warden favor + 25 gp",
      giver: rel("entry", bram, "Captain Bram Ironwood", "🪓"),
      location: rel("page", cinderwood, "The Cinderwood", "🌲"),
    },
    content: [p("Three charcoal burners have gone missing along the Ashvein trail. Bram wants them found — or avenged.")],
  });
  await addEntry(ctx, ws, quests, questRelIds, {
    title: "The Queen's Quiet Word", icon: "✉️", sortOrder: 3000,
    cells: {
      status: "rumor", priority: "high", reward: "Royal patronage",
      giver: rel("entry", serane, "Queen Serane Veldrenn III", "👸"),
      location: rel("page", veldrenn, "The Kingdom of Veldrenn", "👑"),
    },
    content: [p("A palace courier has been asking, discreetly, for adventurers who can keep their mouths shut and their blades sharp.")],
  });
  await addEntry(ctx, ws, quests, questRelIds, {
    title: "Rats in the Kettle Cellar", icon: "🐀", sortOrder: 4000,
    cells: {
      status: "complete", priority: "low", reward: "Free room & board (claimed)",
      location: rel("page", thornhollow, "Thornhollow", "🏘️"),
    },
    content: [p("They were not rats. They were very small emberlings. The Sooty Kettle now serves flame-grilled everything.")],
  });
  await addEntry(ctx, ws, quests, questRelIds, {
    title: "The Moth's Price", icon: "🦋", sortOrder: 5000,
    cells: {
      status: "rumor", priority: "med", reward: "One true secret",
      giver: rel("entry", vexil, "Vexil “The Moth”", "🦋"),
    },
    content: [p("Vexil will trade the Choir's upriver route for a favor to be named later. Everyone who has taken this deal regrets it precisely once.")],
  });

  const vaultRelIds = ["foundAt"];
  await addEntry(ctx, ws, vault, vaultRelIds, {
    title: "Cinderbrand", icon: "🗡️", sortOrder: 1000,
    cells: { rarity: "rare", type: "weapon", attunement: true, foundAt: rel("page", sepulcher, "The Sunken Sepulcher", "🕳️") },
    content: [
      abilityCard({
        name: "Cinderbrand",
        kind: "Weapon (Longsword)",
        subtitle: "Rare · Requires attunement",
        stats: [
          { label: "Bonus", value: "+1 to attack and damage rolls" },
          { label: "Ignite", value: "1d6 extra fire damage on a hit" },
          { label: "Beacon", value: "Sheds bright light in a 20-ft radius while drawn" },
        ],
        text: "When you roll a 20 on an attack roll with this weapon, the target catches fire, taking 1d6 fire damage at the start of each of its turns until a creature uses an action to smother the flames.",
        flavor: "Forged from a fallen shard of Emberfall itself; the blade never quite cools.",
      }),
    ],
  });
  await addEntry(ctx, ws, vault, vaultRelIds, {
    title: "Cloak of the Ember Moth", icon: "🧥", sortOrder: 2000,
    cells: { rarity: "uncommon", type: "wondrous", attunement: true, foundAt: rel("page", cinderwood, "The Cinderwood", "🌲") },
    content: [p("While wearing this dusty-orange cloak, you have Resistance to fire damage, and you can cast Feather Fall on yourself once per day as the cloak splits into a thousand moths.")],
  });
  await addEntry(ctx, ws, vault, vaultRelIds, {
    title: "Phial of Liquid Dawn", icon: "🧴", sortOrder: 3000,
    cells: { rarity: "rare", type: "potion", attunement: false },
    content: [p(["Drinking this bottled sunrise ends the Frightened and Poisoned conditions on you and grants ", dice("2d4+2", "temporary HP"), " temporary hit points. Undead within 10 feet recoil."])],
  });
  await addEntry(ctx, ws, vault, vaultRelIds, {
    title: "Warden's Signet", icon: "💍", sortOrder: 4000,
    cells: { rarity: "common", type: "wondrous", attunement: false, foundAt: rel("page", thornhollow, "Thornhollow", "🏘️") },
    content: [p("A ring of blackened bronze. Any Warden beacon-tower will open its gate to the wearer, and its bearer can always find north.")],
  });

  // ---- page contents ----
  await setContent(ctx, ws, hub, [
    quote("Thirty years ago the sky-fortress Emberfall broke apart above the kingdom, and it has been raining slow embers ever since."),
    p(["Welcome to your campaign hub. The realm of ", mention("page", veldrenn, "The Kingdom of Veldrenn", "👑"), " survived the Night of Falling Embers — but the ", mention("entry", emberChoir, "The Ember Choir", "🎶"), " wants an encore, and the party keeps finding pieces of the sky."]),
    callout("quest", ["Current objective — ", b("The Apothecary's Request"), ": harvest grave-lotus from ", mention("page", sepulcher, "The Sunken Sepulcher", "🕳️"), " for ", mention("entry", maera, "Maera Thistledown", "🌿"), " before the full moon."]),
    h(2, "Party Vitals"),
    tracker("Party Vitals", [
      { name: "Theron (Fighter 3)", kind: "hp", current: 28, max: 31 },
      { name: "Liss (Rogue 3)", kind: "hp", current: 21, max: 24 },
      { name: "Oren (Cleric 3)", kind: "hp", current: 24, max: 27 },
      { name: "Zaya (Wizard 3)", kind: "hp", current: 14, max: 20 },
      { name: "Party Gold", kind: "custom", current: 187, max: 999 },
    ]),
    h(2, "Where everything lives"),
    bullet([mention("page", atlas, "World Atlas", "🗺️"), " — regions, settlements, and dungeon maps"]),
    bullet([mention("page", characters, "Characters", "👥"), " — every PC, ally, and villain, cross-linked"]),
    bullet([mention("page", quests, "Quest Board", "📜"), " — drag quests between Rumor → Active → Complete"]),
    bullet([mention("page", bestiary, "Bestiary", "🐲"), " — stat blocks with rollable abilities"]),
    bullet([mention("page", dmScreen, "DM Screen", "🎲"), " — initiative, trackers, and loot tables for game night"]),
    toggle("How Loreforge works (2-minute tour)", [
      bullet(["Type ", b("/"), " anywhere for blocks: stat blocks, roll tables, trackers, timelines, maps, callouts…"]),
      bullet(["Type ", b("@"), " to link any page or entry — links become ", b("backlinks"), " you can see in the ••• menu."]),
      bullet(["Click any dice chip to roll it: ", dice("1d20+5", "Example check"), " or ", dice("2d6+3", "Damage"), "."]),
      bullet(["Press ", b("⌘J"), " for the dice tray, ", b("⌘K"), " to jump anywhere, ", b("⌘N"), " for a new page."]),
      bullet(["Databases are real: filter, sort, group into boards, and open every row as its own page."]),
    ]),
  ]);

  await setContent(ctx, ws, atlas, [
    p(["The known world, one pin at a time. Add your own maps with ", b("/map"), " — upload an image or sketch on parchment."]),
    mapBlock("The Realm of Veldrenn", [
      { x: 48, y: 30, label: "Vel Aurin (capital)", color: "gold", targetType: "page", targetId: veldrenn },
      { x: 30, y: 58, label: "Thornhollow", color: "green", targetType: "page", targetId: thornhollow },
      { x: 62, y: 55, label: "The Cinderwood", color: "red", targetType: "page", targetId: cinderwood },
      { x: 71, y: 78, label: "The Sunken Sepulcher", color: "violet", targetType: "page", targetId: sepulcher },
    ]),
    h(2, "Travel"),
    rollTable({
      title: "Road Encounters",
      die: "d8",
      rows: [
        { min: 1, max: 2, text: "A Warden patrol shares rumors and hardtack." },
        { min: 3, max: 4, text: "Ash-rain. Everything smells of struck matches for a day." },
        { min: 5, max: 5, text: "A Gilded Scale caravan — toll “suggested,” guards insistent." },
        { min: 6, max: 6, text: "1d4 Cinder Shrikes shadow the party, eyeing anything shiny." },
        { min: 7, max: 7, text: "A pilgrim of the Ember Choir preaching to a scarecrow." },
        { min: 8, max: 8, text: "A shard of Emberfall falls nearby, still warm. It hums." },
      ],
    }),
  ]);

  await setContent(ctx, ws, veldrenn, [
    p(["A river-laced kingdom of terraced hills, beacon-towers, and cities roofed in slate against the ember-rain. Ruled from Vel Aurin by ", mention("entry", serane, "Queen Serane Veldrenn III", "👸"), "."]),
    h(2, "At a glance"),
    table(["Fact", "Detail"], [
      [[b("Capital")], "Vel Aurin, the Slate City"],
      [[b("Ruler")], [mention("entry", serane, "Queen Serane Veldrenn III", "👸")]],
      [[b("Population")], "~400,000 (humans, halflings, dwarves, dragonborn)"],
      [[b("Founded")], "312 DA, by charter of the First Beacon"],
    ]),
    p(["For the full chronology, see ", mention("page", history, "History of Emberfall", "⌛"), "."]),
    h(2, "Power & politics"),
    bullet([mention("entry", crown, "The Crown of Veldrenn", "👑"), " holds the cities; the countryside holds its breath."]),
    bullet([mention("entry", consortium, "Gilded Scale Consortium", "🪙"), " owns the debts of half the noble houses."]),
    bullet([mention("entry", wardens, "Wardens of the Vigil", "🛡️"), " keep the beacon-line lit from the coast to the Cinderwood."]),
    callout("lore", "Law of the Slate: every building in Vel Aurin must keep a rain-barrel of sand on its roof. Ember-rain hasn't fallen on the capital in nine years. The barrels stay."),
  ]);

  await setContent(ctx, ws, cinderwood, [
    p([i("The forest that would not stop burning — so it learned to live with it.")]),
    p(["Black-barked pines with veins of glowing amber, ash drifting like snow, and warmth underfoot that has nothing to do with the sun. Spawn-ground of the ", mention("entry", wyrmling, "Ashvein Wyrmling", "🐉"), " and worse."]),
    callout("danger", ["Open flame ", b("doubles"), " here. Fire damage dealt in the Cinderwood re-ignites at the start of the dealer's next turn (half dice, rounded down)."]),
    h(2, "What the wood wants"),
    p("The Cinderwood is not evil. It is incubating. Every ember that falls is a seed, and thirty years of seeds are nearly ready to hatch."),
    rollTable({
      title: "Cinderwood Encounters",
      die: "d6",
      rows: [
        { min: 1, max: 2, text: "1d4 Emberlings trailing the party like ducklings." },
        { min: 3, max: 4, text: "A grove of glass trees — beautiful, razor-sharp, worth a fortune intact." },
        { min: 5, max: 5, text: "An Ashvein Wyrmling sunning itself on a cooled lava flow." },
        { min: 6, max: 6, text: "A charcoal burner's camp, abandoned mid-meal. The kettle is still warm." },
      ],
    }),
  ]);

  await setContent(ctx, ws, thornhollow, [
    p(["The last village before the Cinderwood, built inside the stump-ring of a felled god-oak. Population 340, opinion of adventurers: cautiously mercantile. Home of ", mention("entry", maera, "Maera Thistledown", "🌿"), " and ", mention("entry", bram, "Captain Bram Ironwood", "🪓"), "."]),
    h(2, "Notable places"),
    table(["Place", "Keeper", "Why go"], [
      ["The Sooty Kettle (inn)", "Marta Kettle", "Rooms, rumors, flame-grilled everything"],
      ["Thistle & Thorn (apothecary)", [mention("entry", maera, "Maera Thistledown", "🌿")], "Potions, poultices, quests"],
      ["The Watchhouse", [mention("entry", bram, "Captain Bram Ironwood", "🪓")], "Bounties and honest work"],
      ["Moth-hole (taproom cellar)", [mention("entry", vexil, "Vexil “The Moth”", "🦋")], "Secrets, for a price"],
    ]),
    h(2, "Rumors at the Kettle"),
    rollTable({
      title: "Kettle Rumors",
      die: "d10",
      rows: [
        { min: 1, max: 2, text: "“The well water's gone bitter since midsummer. Bitter and warm.”" },
        { min: 3, max: 4, text: "“Choir pilgrims bought every candle in the village. Every one.”" },
        { min: 5, max: 6, text: "“Bram's tally shield got three new marks this month.”" },
        { min: 7, max: 8, text: "“The Queen's courier rode through at midnight without changing horses.”" },
        { min: 9, max: 9, text: "“Maera burned a letter in the market square and laughed while it burned.”" },
        { min: 10, max: 10, text: "“The Sepulcher is singing again. Ask the fisherfolk.”" },
      ],
    }),
    callout("quest", ["Hooks here: ", b("The Apothecary's Request"), " (Maera) and ", b("Embers in the Wood"), " (Bram) — both on the ", mention("page", quests, "Quest Board", "📜"), "."]),
  ]);

  await setContent(ctx, ws, sepulcher, [
    p([i("A royal tomb for a dynasty that no longer exists, half-swallowed by the lake that formed when Emberfall broke the river.")]),
    p(["Current tenants: drowned dead, grave-lotus, and an Ember Choir work-crew led by ", mention("entry", korvan, "High Ashpriest Korvan", "🔥"), " digging for a shard the size of a wagon."]),
    h(2, "The descent"),
    toggle("1. The Drowned Antechamber", [
      p("Waist-deep water, ceiling mosaics of the first kings. Two Sepulcher Guardians stand where the water is deepest — they do not react to torchlight, only to splashing."),
      callout("danger", ["Stealth (DC 13) to wade quietly; failure wakes a ", mention("entry", guardian, "Sepulcher Guardian", "🗿"), "."]),
    ]),
    toggle("2. The Flooded Chapel", [
      p("Grave-lotus blooms across the pews in pale drifts — harvesting all three takes 10 minutes or three successful DC 12 Nature checks."),
      callout("treasure", "The Choir's shard-reliquary sits on the altar. It is warm, it hums, and the Choir will absolutely notice it missing."),
    ]),
    toggle("3. The Vault of Kings", [
      p("Sealed. The Choir has cracked the outer door; the inner one bears a riddle in Old Veldric and a slot shaped exactly like a shard of Emberfall."),
      callout("dm", "Behind it: the Wyrm-Gate and campaign act two. Do not let them in before level 5."),
    ]),
    h(2, "Denizens"),
    p([mention("entry", guardian, "Sepulcher Guardian", "🗿"), " · drowned skeletons (use zombie stats, waterlogged) · ", mention("entry", korvan, "High Ashpriest Korvan", "🔥"), " (act boss)"]),
  ]);

  await setContent(ctx, ws, journal, [
    p("One page per session. The template below keeps recaps painless — duplicate the last session and start typing."),
    bullet(["Start each entry with the date and a one-line ", b("cold open"), "."]),
    bullet(["Track loot and XP in the session page, then move items into the ", mention("page", vault, "Vault of Wonders", "✨"), "."]),
    bullet(["End with next session's hook while it's fresh."]),
  ]);

  await setContent(ctx, ws, session0, [
    p([b("Cold open: "), i("Ash on the wind, a village that smells of soot and stew, and a job notice written in a very neat apothecary's hand.")]),
    h(2, "Attendance"),
    table(["Player", "Character", "Present"], [
      ["Sam", "Theron — Human Fighter (Champion)", "✅"],
      ["Ria", "Liss — Halfling Rogue (Thief)", "✅"],
      ["Owen", "Oren — Dwarf Cleric (Life)", "✅"],
      ["Zoe", "Zaya — Elf Wizard (Evoker)", "✅"],
    ]),
    h(2, "What happened"),
    num("The party met at the Sooty Kettle over a suspicious stew and a job notice."),
    num(["Maera explained the coughing sickness and offered ", b("The Apothecary's Request"), "."]),
    num("A bar brawl with Gilded Scale toughs ended with Liss owning three new daggers and one new enemy."),
    num(["Bram deputized the party after Theron rolled ", dice("1d20+5", "Persuasion"), " and got a 23."]),
    h(2, "Loot & XP"),
    bullet(["3 daggers (Liss), 12 gp, one Warden's Signet — logged in the ", mention("page", vault, "Vault of Wonders", "✨")]),
    bullet(["XP: 300 each — level 3 next session"]),
    callout("note", ["Next time: the road to the ", mention("page", sepulcher, "The Sunken Sepulcher", "🕳️"), ", and whatever is singing down there."]),
  ]);

  await setContent(ctx, ws, history, [
    quote("Ask three sages when the kingdom began and you will get four answers and a bar fight."),
    timeline("The Ages of Veldrenn", [
      {
        name: "The Dawn Age", color: "gold",
        events: [
          { date: "1 DA", title: "The First Beacon", text: "Veldrenn the Elder lights a signal fire on Slate Hill; a kingdom accretes around it." },
          { date: "312 DA", title: "Founding of Vel Aurin", text: "The Slate City is chartered. The rain-barrel law is older than the palace." },
          { date: "790 DA", title: "The Sky-Fortress Rises", text: "The archmages of the Concord raise Emberfall — a city in the clouds, anchored by the Crown of Cinders." },
        ],
      },
      {
        name: "The Falling Embers", color: "red",
        events: [
          { date: "961 DA", title: "The Night of Falling Embers", text: "A ritual gone wrong — or exactly right. Emberfall shatters; burning stone rains for nine days.", targetType: "page", targetId: veldrenn, targetLabel: "The Kingdom of Veldrenn" },
          { date: "961–974 DA", title: "The Ember Wars", text: "Warlords fight over shard-falls. The Wardens of the Vigil are founded to hold the line." },
          { date: "975 DA", title: "The Slate Accord", text: "Serane III, aged fourteen, is crowned and ends the wars with maps instead of armies." },
        ],
      },
      {
        name: "The Present Age", color: "violet",
        events: [
          { date: "991 DA", title: "The Choir Returns", text: "Ash-robed pilgrims begin buying candles, singing to shards, and digging where they shouldn't.", targetType: "entry", targetId: emberChoir, targetLabel: "The Ember Choir" },
          { date: "994 DA (now)", title: "The Coughing Sickness", text: "Thornhollow's water turns bitter. The campaign begins.", targetType: "page", targetId: thornhollow, targetLabel: "Thornhollow" },
        ],
      },
    ]),
  ]);

  await setContent(ctx, ws, dmScreen, [
    h(2, "Combat"),
    encounter("Sepulcher — Antechamber", [
      { name: "Theron", init: 14, hp: 31, maxHp: 31, ac: "18", isPC: true },
      { name: "Liss", init: 19, hp: 24, maxHp: 24, ac: "15", isPC: true },
      { name: "Oren", init: 8, hp: 27, maxHp: 27, ac: "17", isPC: true },
      { name: "Zaya", init: 12, hp: 20, maxHp: 20, ac: "12", isPC: true },
      { name: "Sepulcher Guardian A", init: 10, hp: 52, maxHp: 52, ac: "16" },
      { name: "Sepulcher Guardian B", init: 10, hp: 52, maxHp: 52, ac: "16" },
    ]),
    h(2, "Table state"),
    tracker("Table State", [
      { name: "Alarm level (Sepulcher)", kind: "custom", current: 1, max: 5 },
      { name: "Days to full moon", kind: "custom", current: 6, max: 9 },
      { name: "Inspiration bank", kind: "hope", current: 2, max: 4 },
    ]),
    h(2, "Quick rolls"),
    p(["Guardian fist ", dice("1d20+6", "Attack"), " → ", dice("2d6+4", "Bludgeoning"), "  ·  Wyrmling breath ", dice("5d6", "Fire, DC 12 Dex"), "  ·  Sneak attack ", dice("1d4+2d6+3", "Liss")]),
    h(2, "Instant loot"),
    rollTable({
      title: "Instant Loot",
      die: "d12",
      rows: [
        { min: 1, max: 3, text: "2d6 sp and a bent but honest knife." },
        { min: 4, max: 6, text: "A shard-chip pendant (5 gp; hums near the Sepulcher)." },
        { min: 7, max: 8, text: "Potion of Healing in a flask shaped like a kettle." },
        { min: 9, max: 10, text: "A Gilded Scale promissory note for 25 gp — redeemable, traceable." },
        { min: 11, max: 11, text: "Warden signal-flare (single use, visible for miles)." },
        { min: 12, max: 12, text: "Roll on the Vault of Wonders instead — something real." },
      ],
    }),
    h(2, "Rules within reach"),
    p(["Conditions live in ", mention("page", conditions, "Conditions (2024)", "🌀"), "; the action list is in ", mention("page", combatSheet, "Combat Cheat Sheet", "⚔️"), "."]),
    callout("dm", "Pacing valve: if the session drags, a shard falls somewhere inconvenient. If it races, the Choir sings back."),
  ]);

  await setContent(ctx, ws, rules, [
    p("House rules and fast references. Keep this section lean — the table only needs what the table uses."),
    callout("note", ["This section includes material adapted from the ", b("System Reference Document 5.2.1"), " by Wizards of the Coast LLC, available under the Creative Commons Attribution 4.0 International License."]),
  ]);

  await setContent(ctx, ws, conditions, [
    p([b("2024 rules."), " The ones that come up constantly, condensed:"]),
    table(["Condition", "Short version"], [
      [[b("Blinded")], "Can't see; auto-fail sight checks. Attacks against you have Advantage, yours have Disadvantage."],
      [[b("Charmed")], "Can't attack the charmer; they have Advantage on social checks against you."],
      [[b("Frightened")], "Disadvantage on checks/attacks while the source is in sight; can't willingly move closer to it."],
      [[b("Grappled")], "Speed 0. Attacks have Disadvantage against anyone but the grappler. Escape: Str (Athletics) or Dex (Acrobatics) vs. the grapple DC."],
      [[b("Incapacitated")], "No actions, Bonus Actions, or Reactions; concentration breaks; you can't speak."],
      [[b("Invisible")], "Can't be seen without magic: you have Advantage on attacks, attacks against you have Disadvantage."],
      [[b("Paralyzed")], "Incapacitated, can't move or speak; auto-fail Str/Dex saves; attacks against you have Advantage and crit within 5 ft."],
      [[b("Poisoned")], "Disadvantage on attack rolls and ability checks."],
      [[b("Prone")], "Crawl or stand (half speed cost). Your attacks have Disadvantage; melee attacks against you have Advantage, ranged have Disadvantage."],
      [[b("Restrained")], "Speed 0. Attacks against you have Advantage, yours have Disadvantage; Disadvantage on Dex saves."],
      [[b("Stunned")], "Incapacitated; auto-fail Str/Dex saves; attacks against you have Advantage."],
      [[b("Unconscious")], "Incapacitated, prone, drop everything; auto-fail Str/Dex saves; attacks have Advantage and crit within 5 ft."],
    ]),
    h(3, "Exhaustion (2024)"),
    p(["Each level: ", b("−2 to all d20 Tests"), " and ", b("−5 ft. Speed"), ", cumulative. Level 6 = death. Remove one level per Long Rest."]),
    callout("note", "Adapted from SRD 5.2.1 (CC-BY-4.0, Wizards of the Coast LLC)."),
  ]);

  await setContent(ctx, ws, combatSheet, [
    h(2, "Actions in combat (2024)"),
    table(["Action", "Use it to…"], [
      [[b("Attack")], "Make attack rolls (weapon or Unarmed Strike)."],
      [[b("Dash")], "Move extra distance equal to your Speed."],
      [[b("Disengage")], "Move without provoking Opportunity Attacks."],
      [[b("Dodge")], "Attacks against you have Disadvantage; Dex saves with Advantage."],
      [[b("Help")], "Give an ally Advantage on their next check or attack."],
      [[b("Hide")], "Dex (Stealth) DC 15 while obscured — gain the Invisible condition on success."],
      [[b("Influence")], "Charisma or Wisdom check to sway a creature's attitude."],
      [[b("Magic")], "Cast a spell or use a magical feature."],
      [[b("Ready")], "Prepare an action with a trigger; uses your Reaction."],
      [[b("Search")], "Wisdom (Insight/Perception/Survival) to find something."],
      [[b("Study")], "Intelligence check to recall or analyze."],
      [[b("Utilize")], "Use a nonmagical object."],
    ]),
    h(3, "Cover"),
    p([b("Half cover"), " +2 AC/Dex saves · ", b("Three-quarters"), " +5 · ", b("Total"), " can't be targeted directly."]),
    h(3, "Useful dice"),
    p(["Ability check ", dice("1d20", "Check"), " · Advantage ", dice("2d20kh1", "Advantage"), " · Disadvantage ", dice("2d20kl1", "Disadvantage"), " · Death save ", dice("1d20", "Death save")]),
    callout("note", "Adapted from SRD 5.2.1 (CC-BY-4.0, Wizards of the Coast LLC)."),
  ]);

  return ws;
}
