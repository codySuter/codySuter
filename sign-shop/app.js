/* STIHL Sign Shop — search a power tool, build an accurate 5×3 shelf sign,
   print or save it as PDF. Data comes from data/products.js (generated from
   the dealer price file + SKU master listing) and data/specs.js. */

(function () {
  "use strict";

  const BUNDLED = window.SIGN_DATA;
  const SPECS = window.SIGN_SPECS || {};
  const SPECS_DSM = window.SIGN_SPECS_DSM || {};   // from the Dealer Support Manual
  const DSM_PARTS = window.SIGN_DSM_PARTS || {};   // bar/chain parts per unit material
  const CATALOG = window.SIGN_CATALOG || {};       // bar & chain catalog fitment rows
  const LS_KEY = "signshop.overrides.v1";
  const LS_DATA_KEY = "signshop.dataset.v1";
  let DATA = null; // adopted below (imported dealer file, else bundled)

  const $ = (sel, el) => (el || document).querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ---------------- persistence ---------------- */
  let overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) {}
  const saveOverrides = () => localStorage.setItem(LS_KEY, JSON.stringify(overrides));
  const ov = (id) => overrides[id] || {};
  const setOv = (id, patch) => {
    overrides[id] = Object.assign({}, overrides[id], patch);
    saveOverrides();
  };

  /* ---------------- barcode (UPC-A / EAN-13) ---------------- */
  const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const G = L.map(p => p.split("").reverse().map(b => b === "0" ? "1" : "0").join(""));
  const R = L.map(p => p.split("").map(b => b === "0" ? "1" : "0").join(""));
  const EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

  function checkDigit(digits) { // digits: array of ints, no check digit
    let sum = 0;
    const fromRight = digits.slice().reverse();
    for (let i = 0; i < fromRight.length; i++) {
      sum += fromRight[i] * (i % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10;
  }

  // Returns {modules, text, corrected} or null if not encodable.
  function encodeBarcode(value) {
    const raw = (value || "").replace(/\D/g, "");
    if (raw.length !== 12 && raw.length !== 13) return null;
    let digits = raw.split("").map(Number);
    const body = digits.slice(0, -1);
    const chk = checkDigit(body);
    const corrected = chk !== digits[digits.length - 1];
    digits = body.concat(chk);

    let mods = "101";
    if (digits.length === 12) { // UPC-A
      for (let i = 0; i < 6; i++) mods += L[digits[i]];
      mods += "01010";
      for (let i = 6; i < 12; i++) mods += R[digits[i]];
      mods += "101";
      const t = digits.join("");
      return { modules: mods, text: t[0] + " " + t.slice(1, 6) + " " + t.slice(6, 11) + " " + t[11], corrected };
    }
    // EAN-13
    const parity = EAN_PARITY[digits[0]];
    for (let i = 1; i < 7; i++) mods += (parity[i - 1] === "L" ? L : G)[digits[i]];
    mods += "01010";
    for (let i = 7; i < 13; i++) mods += R[digits[i]];
    mods += "101";
    const t = digits.join("");
    return { modules: mods, text: t[0] + " " + t.slice(1, 7) + " " + t.slice(7), corrected };
  }

  function barcodeSVG(value, widthPx, heightPx) {
    const enc = encodeBarcode(value);
    if (!enc) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + widthPx + '" height="' + heightPx +
        '"><rect width="100%" height="100%" fill="#fff" stroke="#ccc" stroke-dasharray="3 2"/>' +
        '<text x="50%" y="55%" text-anchor="middle" font-family="Barlow,sans-serif" font-size="8" fill="#999">NO UPC ON FILE</text></svg>';
    }
    const m = enc.modules;
    const mw = widthPx / m.length;
    let bars = "";
    let run = 0;
    for (let i = 0; i <= m.length; i++) {
      if (i < m.length && m[i] === "1") { run++; continue; }
      if (run > 0) {
        bars += '<rect x="' + ((i - run) * mw).toFixed(3) + '" y="0" width="' + (run * mw).toFixed(3) +
                '" height="' + heightPx + '" fill="#191919"/>';
        run = 0;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + widthPx + '" height="' + heightPx +
           '" shape-rendering="crispEdges">' + bars + "</svg>";
  }

  /* ---------------- spec defaults ---------------- */
  const BATTERY_CATS = { "0LB": 1, "1HB": 1, "1LB": 1, "1ZB": 1, "1IB": 1 };
  const ELECTRIC_MODELS = /^(FSE|BGE|HSE|RE\b|SE\b)/;

  function specHints(model) {
    // Pull spec fragments out of the dealer file's own descriptions.
    const text = model.variants.map(v => v.retail + " " + v.desc).join(" | ");
    const hints = {};
    let m;
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*cc/i))) hints.displacement = m[1] + " cc";
    if ((m = text.match(/(\d+)\s*V(?:olt)?\b/))) hints.volts = m[1] + " V";
    if ((m = text.match(/(\d+)\s*CFM/i))) hints.cfm = m[1] + " cfm";
    if ((m = text.match(/(\d+)\s*mph/i))) hints.mph = m[1] + " mph";
    if ((m = text.match(/(\d+)\s*psi/i))) hints.psi = m[1] + " psi";
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*Ah/i))) hints.ah = m[1] + " Ah";
    return hints;
  }

  function defaultSpecs(model) {
    const dsm = SPECS_DSM[model.model];
    if (dsm) {
      // fill any cell the manual leaves blank (e.g. gas saw powerhead
      // weight) from the curated library, matched by label
      const curatedRows = (SPECS[model.model] || {}).specs || [];
      const byLabel = {};
      curatedRows.forEach(([l, v]) => { byLabel[l.toUpperCase()] = v; });
      const rows = dsm.specs.map(([l, v]) =>
        [l, v || byLabel[l.toUpperCase()] || ""]);
      return {
        title: dsm.title,
        specs: rows,
        source: "from the 2026 Dealer Support Manual V2"
      };
    }
    const curated = SPECS[model.model];
    if (curated) {
      return {
        title: curated.title,
        specs: curated.specs.map(s => s.slice()),
        source: "STIHL published specs — review before printing"
      };
    }
    // powerhead attachments have no engine of their own
    if (model.category === "3TT" || model.category === "3MA") {
      return {
        title: "SPECIFICATIONS",
        specs: [
          ["FITS", model.category === "3TT"
            ? "STIHL KombiMotors" : "MM 56 YARD BOSS"],
          ["WEIGHT", ""],
          ["OVERALL LENGTH", ""],
          ["", ""]
        ],
        source: "attachment — fill in from the Kombi pages as needed"
      };
    }
    const h = specHints(model);
    const isBattery = BATTERY_CATS[model.category] ||
      /^[A-Z]{2,3}A\s/.test(model.model + " ") || h.volts;
    if (isBattery) {
      return {
        title: "BATTERY & PERFORMANCE",
        specs: [
          ["BATTERY SYSTEM", h.volts || ""],
          ["WEIGHT", ""],
          ["RUN TIME (UP TO)", ""],
          ["CHARGE TIME", ""]
        ],
        source: h.volts ? "voltage from dealer file — complete remaining specs" : "no specs on file yet — fill in below"
      };
    }
    if (ELECTRIC_MODELS.test(model.model)) {
      return {
        title: "SPECIFICATIONS",
        specs: [
          ["POWER SOURCE", "120 V corded"],
          ["WEIGHT", ""],
          [model.category === "1RB" ? "MAX PRESSURE" : "PERFORMANCE", h.psi || ""],
          ["", ""]
        ],
        source: "no specs on file yet — fill in below"
      };
    }
    const specs = [
      ["DISPLACEMENT", h.displacement || ""],
      ["POWER OUTPUT", ""],
      [model.category === "0CS" ? "POWERHEAD WEIGHT" : "WEIGHT", ""],
      ["FUEL CAPACITY", ""]
    ];
    if (model.category === "1BB" || model.category === "1BH") {
      specs[1] = ["AIR VOLUME", h.cfm || ""];
      specs[3] = ["MAX AIR VELOCITY", h.mph || ""];
    }
    return {
      title: "ENGINE & PERFORMANCE",
      specs,
      source: h.displacement ? "displacement from dealer file — complete remaining specs"
                             : "no specs on file yet — fill in below"
    };
  }

  function specCompleteness(model) {
    const merged = current(model);
    const filled = merged.specs.filter(s => s[1] && s[1].trim()).length;
    return filled >= 4 ? "full" : filled > 0 ? "partial" : "none";
  }

  /* ---------------- config assembly ---------------- */
  // What the length dimension is called on this kind of tool.
  const SAW_CATS = { "0CS": 1, "0LB": 1, "0ES": 1, "0GS": 1 };

  function lengthWord(category) {
    if (SAW_CATS[category] || category === "1HT") return "Bar";
    if (category === "1HS" || category === "1HB") return "Blade";
    if (category === "0TS") return "Wheel";
    return "";
  }

  // A description tail like "AutoCut 27-2" distinguishes variants; a lone
  // lowercase word like "backpack" does not.
  function meaningfulTail(v) {
    const tail = v.desc.split(",").slice(1).join(", ").trim();
    if (!tail) return "";
    if (/\d/.test(tail) || tail.split(/\s+/).length > 1) return tail;
    return "";
  }

  function variantName(v, category) {
    const dsm = DSM_PARTS[v.materialDash] || {};
    const parts = [];
    const barIn = v.barIn || dsm.barLen;
    if (barIn) {
      const w = lengthWord(category);
      parts.push(barIn + "″" + (w ? " " + w : ""));
    }
    // the DSM chain name carries the drive-link count ('61PS3 50'), so it
    // beats the dealer description's bare family code; display as '61 PS3 50'
    const chain = (dsm.chainName
      ? dsm.chainName.replace(/^(\d{2})\s?(\S)/, "$1 $2")
      : "") || v.chain;
    if (chain) parts.push(chain);
    if (!parts.length) {
      const tail = meaningfulTail(v);
      if (tail) parts.push(tail);
    }
    return parts.join(" · ") || "Standard";
  }

  function configLabel(v, category) {
    return variantName(v, category).toUpperCase();
  }

  function sideName(v, category) {
    return variantName(v, category);
  }

  let modelById = {};

  // Defaults always derive from the chosen floor variant; stored field
  // overrides are applied on top, so switching variants never leaks
  // another variant's price/SKU/UPC into the sign.
  function current(model) {
    const o = ov(model.id);
    const floorIdx = Math.min(
      o.floorIdx !== undefined ? o.floorIdx : 0, model.variants.length - 1);
    const v = model.variants[floorIdx];
    const ds = defaultSpecs(model);
    const d = {
      floorIdx,
      category: model.signCategory,
      model1: model.model,
      model2: model.nickname || "",
      config: configLabel(v, model.category),
      price: v.msrp.toFixed(2),
      sku: v.aceSku || "",
      upc: v.upc || "",
      specTitle: ds.title,
      specs: ds.specs,
      specSource: ds.source,
      // the sidebar fits ~3 configurations (like the template); models with
      // more variants start with the first three shown, rest togglable
      side: model.variants.map((x, i) => ({
        material: x.materialDash,
        include: model.variants.length <= 3 || i < 3,
        label: sideName(x, model.category),
        price: x.msrp.toFixed(2),
        sku: x.aceSku || "",
        chain: (DSM_PARTS[x.materialDash] || {}).chain || "",
        bar: (DSM_PARTS[x.materialDash] || {}).bar || ""
      }))
    };
    const merged = Object.assign({}, d, o);
    merged.floorIdx = floorIdx;
    merged.specSource = d.specSource;
    if (o.specs) merged.specs = o.specs.map(s => s.slice());
    const sideOv = o.side || {};
    merged.side = d.side.map(item =>
      Object.assign({}, item, sideOv[item.material] || {}));
    return merged;
  }

  /* ---------------- sign rendering ---------------- */
  function money(str) {
    const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
    if (isNaN(n)) return { d: "—", c: "" };
    const [d, c] = n.toFixed(2).split(".");
    return { d: Number(d).toLocaleString("en-US"), c };
  }

  function renderSign(model, cfg) {
    const sign = $("#sign");
    sign.innerHTML = "";

    const main = el("div", "sign-main");
    const top = el("div", "sign-top");
    const logo = el("div", "sign-logo", "STIHL");
    logo.appendChild(el("sup", "", "®"));
    top.appendChild(logo);
    top.appendChild(el("div", "sign-cat", cfg.category));
    main.appendChild(top);

    const modelLine = el("div", "sign-model");
    modelLine.appendChild(el("span", "m1", cfg.model1));
    if (cfg.model2) modelLine.appendChild(el("span", "m2", cfg.model2));
    main.appendChild(modelLine);

    const cfgrow = el("div", "sign-cfgrow");
    cfgrow.appendChild(el("span", "sign-cfglabel", "MODEL CONFIGURED ON FLOOR"));
    cfgrow.appendChild(el("span", "sign-cfgpill", cfg.config));
    main.appendChild(cfgrow);

    const price = el("div", "sign-price");
    const m = money(cfg.price);
    price.appendChild(el("span", "cur", "$"));
    price.appendChild(el("span", "dollars", m.d));
    price.appendChild(el("span", "cents", m.c));
    main.appendChild(price);

    main.appendChild(el("div", "sign-spechead", cfg.specTitle));
    const grid = el("div", "sign-specgrid");
    cfg.specs.forEach(([label, value]) => {
      const cell = el("div", "sign-spec");
      cell.appendChild(el("div", "sl", label || " "));
      cell.appendChild(el("div", "sv", (value && value.trim()) || "—"));
      grid.appendChild(cell);
    });
    main.appendChild(grid);

    const bottom = el("div", "sign-bottom");
    const bc = el("div", "sign-barcode");
    const enc = encodeBarcode(cfg.upc);
    bc.innerHTML = barcodeSVG(cfg.upc, 118, 30);
    if (enc) bc.appendChild(el("div", "sign-upctext", enc.text));
    bottom.appendChild(bc);
    const skub = el("div", "sign-skublock");
    skub.appendChild(el("div", "sign-skulabel", "STORE SKU"));
    skub.appendChild(el("div", "sign-skubox", cfg.sku || "—"));
    bottom.appendChild(skub);
    main.appendChild(bottom);
    sign.appendChild(main);

    const side = el("aside", "sign-side");
    side.appendChild(el("div", "sign-sidehead", "OTHER CONFIGURATIONS"));
    side.appendChild(el("div", "sign-sidenote", "Options listed may not be in stock"));
    const items = el("div", "sign-sideitems");
    cfg.side.filter(s => s.include).forEach(s => {
      const it = el("div", "side-item");
      const t = el("div", "si-top");
      t.appendChild(el("span", "si-name", s.label));
      const pm = money(s.price);
      const p = el("span", "si-price");
      p.innerHTML = "$" + pm.d + '<span class="c">' + pm.c + "</span>";
      t.appendChild(p);
      it.appendChild(t);
      const rows = [["SKU", s.sku || "—"]];
      if (SAW_CATS[model.category]) {
        rows.push(["CHAIN PART #", s.chain || "—"]);
        rows.push(["BAR PART #", s.bar || "—"]);
      } else if (s.chain || s.bar) {
        if (s.chain) rows.push(["PART #", s.chain]);
        if (s.bar) rows.push(["PART #", s.bar]);
      }
      rows.forEach(([rl, rv]) => {
        const r = el("div", "si-row");
        r.appendChild(el("span", "si-rl", rl));
        r.appendChild(el("span", "si-rv", rv));
        it.appendChild(r);
      });
      items.appendChild(it);
    });
    side.appendChild(items);
    sign.appendChild(side);
  }

  /* ---------------- editor rendering ---------------- */
  let selectedId = null;

  function bindInput(input, modelId, key, after) {
    input.addEventListener("input", () => {
      setOv(modelId, { [key]: input.value });
      refresh(false);
      if (after) after();
    });
  }

  function renderEditor(model, cfg) {
    const ed = $("#editor");
    ed.hidden = false;

    const vsel = $("#ed-variant");
    vsel.innerHTML = "";
    model.variants.forEach((v, i) => {
      const o = el("option", "", sideName(v, model.category) + "  —  $" + v.msrp.toFixed(2) +
        (v.status === "C" ? "  (closeout)" : ""));
      o.value = i;
      vsel.appendChild(o);
    });
    vsel.value = cfg.floorIdx;
    vsel.onchange = () => {
      const o = ov(model.id);
      // switching floor config resets its dependent fields to file data
      delete o.price; delete o.sku; delete o.upc; delete o.config;
      o.floorIdx = Number(vsel.value);
      overrides[model.id] = o; saveOverrides();
      refresh(true);
    };

    const fields = [
      ["#ed-category", "category"],
      ["#ed-model1", "model1"],
      ["#ed-model2", "model2"],
      ["#ed-config", "config"],
      ["#ed-price", "price"],
      ["#ed-sku", "sku"],
      ["#ed-upc", "upc"]
    ];
    fields.forEach(([sel, key]) => {
      const input = $(sel);
      const clone = input.cloneNode(true); // drop old listeners
      input.parentNode.replaceChild(clone, input);
      clone.value = cfg[key] || "";
      clone.classList.toggle("overridden", ov(model.id)[key] !== undefined);
      bindInput(clone, model.id, key);
    });

    const note = $("#upc-note");
    const enc = encodeBarcode(cfg.upc);
    if (!cfg.upc) {
      note.hidden = false; note.className = "ed-note warn";
      note.textContent = "No UPC on file for this configuration — the sign will print without a barcode unless you enter one.";
    } else if (!enc) {
      note.hidden = false; note.className = "ed-note warn";
      note.textContent = "UPC must be 12 digits (UPC-A) or 13 digits (EAN-13) to render a barcode.";
    } else if (enc.corrected) {
      note.hidden = false; note.className = "ed-note warn";
      note.textContent = "Warning: the UPC check digit didn't validate — barcode rendered with the corrected check digit (" + enc.text + "). Verify the UPC.";
    } else { note.hidden = true; }

    $("#spec-source").textContent = cfg.specSource ? "— " + cfg.specSource : "";
    const st = $("#ed-spectitle");
    const stc = st.cloneNode(true); st.parentNode.replaceChild(stc, st);
    stc.value = cfg.specTitle; bindInput(stc, model.id, "specTitle");

    const specHost = $("#ed-specs");
    specHost.innerHTML = "";
    cfg.specs.forEach((pair, i) => {
      const wrap = el("div", "ed-spec");
      const li = el("input", "spec-label"); li.value = pair[0]; li.placeholder = "LABEL";
      const vi = el("input"); vi.value = pair[1]; vi.placeholder = "value";
      const save = () => {
        const specs = current(model).specs;
        specs[i] = [li.value, vi.value];
        setOv(model.id, { specs });
        refresh(false);
      };
      li.addEventListener("input", save);
      vi.addEventListener("input", save);
      wrap.appendChild(li); wrap.appendChild(vi);
      specHost.appendChild(wrap);
    });

    renderSideEditor(model, cfg);

    $("#btn-reset").onclick = () => {
      delete overrides[model.id];
      saveOverrides();
      refresh(true);
    };
  }

  // Bar & Chain Catalog fitment rows for a model (falls back to the base
  // designation: "MSA 220.0 C-B" -> "MSA 220.0 C" -> "MSA 220.0" -> …).
  function catalogRows(modelName) {
    let name = modelName;
    while (name) {
      if (CATALOG[name]) return CATALOG[name];
      if (/-[A-Z]+$/.test(name)) { name = name.replace(/-[A-Z]+$/, ""); continue; }
      const cut = name.replace(/ ?[^ ]*$/, "");
      if (cut === name) break;
      name = cut;
    }
    return null;
  }

  function chainOptions(model, variant) {
    const norm = s => (s || "").replace(/[\s-]/g, "").toUpperCase();
    const fam = variant && variant.chain ? norm(variant.chain) : "";
    // catalog-verified loops for this model + bar length
    const rows = catalogRows(model.model) || [];
    const catParts = new Set();
    rows.forEach(r => {
      if (!variant || !variant.barIn || r.bar === variant.barIn) {
        r.chains.forEach(c => catParts.add(c.part));
      }
    });
    const suggested = [], rest = [];
    DATA.chains.forEach(c => {
      const isLoop = !/reel/i.test(c.desc);
      const hit = isLoop && (catParts.has(c.part) ||
        (!catParts.size && fam && norm(c.marketing).startsWith(fam)));
      (hit ? suggested : rest).push(c);
    });
    return { suggested, rest, fromCatalog: catParts.size > 0 };
  }

  function renderSideEditor(model, cfg) {
    const host = $("#ed-side");
    host.innerHTML = "";
    const isSaw = !!SAW_CATS[model.category];

    cfg.side.forEach((item, idx) => {
      const variant = model.variants[idx];
      const card = el("div", "ed-sideitem");
      const top = el("div", "top");
      const chk = el("input"); chk.type = "checkbox"; chk.checked = item.include;
      top.appendChild(chk);
      top.appendChild(el("span", "t-name", sideName(variant, model.category)));
      top.appendChild(el("span", "t-mat", variant.material + (variant.status === "C" ? " · CLOSEOUT" : "")));
      card.appendChild(top);

      const grid = el("div", "grid");
      const li = el("input"); li.value = item.label;
      const pi = el("input"); pi.value = item.price; pi.inputMode = "decimal";
      const si = el("input"); si.value = item.sku; si.placeholder = "SKU";
      [["Label", li], ["Price ($)", pi], ["SKU", si]].forEach(([lab, input]) => {
        const w = el("div");
        const l = el("label", "", lab);
        w.appendChild(l); w.appendChild(input); grid.appendChild(w);
      });
      card.appendChild(grid);

      const saveItem = (patch) => {
        const o = ov(model.id);
        const side = Object.assign({}, o.side);
        side[item.material] = Object.assign({}, side[item.material], patch);
        setOv(model.id, { side });
        refresh(false);
      };
      chk.addEventListener("change", () => saveItem({ include: chk.checked }));
      li.addEventListener("input", () => saveItem({ label: li.value }));
      pi.addEventListener("input", () => saveItem({ price: pi.value }));
      si.addEventListener("input", () => saveItem({ sku: si.value }));

      if (isSaw) {
        const g2 = el("div", "grid2");
        // chain picker
        const cw = el("div");
        cw.appendChild(el("label", "", "Chain part #"));
        const csel = el("select");
        csel.appendChild(el("option", "", "— none —")).value = "";
        const { suggested, rest, fromCatalog } = chainOptions(model, variant);
        const addGroup = (label, list) => {
          if (!list.length) return;
          const og = document.createElement("optgroup");
          og.label = label;
          list.forEach(c => {
            const o = el("option", "",
              (c.marketing ? c.marketing + " — " : "") + c.part +
              (c.desc ? "  (" + c.desc.replace(/ chain.*$/i, "") + ")" : ""));
            o.value = c.part;
            og.appendChild(o);
          });
          csel.appendChild(og);
        };
        addGroup(fromCatalog
          ? "Fits this saw" + (variant.barIn ? " @ " + variant.barIn + "″" : "") + " (B&C catalog)"
          : "Suggested (" + (variant.chain || "match") + ")", suggested);
        addGroup("All chains", rest);
        csel.value = item.chain || "";
        csel.addEventListener("change", () => saveItem({ chain: csel.value }));
        cw.appendChild(csel);
        g2.appendChild(cw);

        // bar picker
        const bw = el("div");
        bw.appendChild(el("label", "", "Bar part #"));
        const bsel = el("select");
        bsel.appendChild(el("option", "", "— none —")).value = "";
        const sug = DATA.bars.filter(b => b.lengthIn === variant.barIn);
        const others = DATA.bars.filter(b => b.lengthIn !== variant.barIn);
        const addBars = (label, list) => {
          if (!list.length) return;
          const og = document.createElement("optgroup");
          og.label = label;
          list.forEach(b => {
            const o = el("option", "", b.part + "  (" + b.desc.replace(/^Guide bar\s*/i, "") + ")");
            o.value = b.part;
            og.appendChild(o);
          });
          bsel.appendChild(og);
        };
        addBars(variant.barIn ? 'Suggested (' + variant.barIn + '" bars)' : "Suggested", sug);
        addBars("All bars", others);
        bsel.value = item.bar || "";
        bsel.addEventListener("change", () => saveItem({ bar: bsel.value }));
        bw.appendChild(bsel);
        g2.appendChild(bw);
        card.appendChild(g2);
      }
      host.appendChild(card);
    });
  }

  /* ---------------- search / results ---------------- */
  let activeCat = "";
  let searchIndex = [];

  function adoptDataset(data) {
    DATA = data;
    modelById = {};
    DATA.models.forEach(m => { modelById[m.id] = m; });
    searchIndex = DATA.models.map(m => ({
      name: (m.model + " " + m.nickname).toLowerCase(),
      cat: m.categoryName.toLowerCase(),
      text: (m.model + " " + m.nickname + " " + m.categoryName + " " +
        m.variants.map(v => v.retail + " " + v.desc + " " + v.material + " " +
          v.materialDash + " " + v.aceSku + " " + v.upc).join(" ")).toLowerCase()
    }));
  }

  // Rank: model-name hits beat category hits beat SKU/UPC/description hits.
  function scoreModel(idx, tokens) {
    const s = searchIndex[idx];
    let score = 0;
    for (const t of tokens) {
      if (s.name.startsWith(t)) score += 5;
      else if (s.name.includes(t)) score += 3;
      else if (s.cat.includes(t)) score += 1;
      else if (s.text.includes(t)) score += 1;
      else return -1; // every token must match somewhere
    }
    return score;
  }

  function renderCats() {
    const host = $("#cat-chips");
    host.innerHTML = "";
    const all = el("span", "chip" + (activeCat === "" ? " active" : ""), "All");
    all.onclick = () => { activeCat = ""; renderCats(); renderResults(); };
    host.appendChild(all);
    DATA.categories.forEach(c => {
      if (!DATA.models.some(m => m.category === c.code)) return;
      const chip = el("span", "chip" + (activeCat === c.code ? " active" : ""), c.name);
      chip.onclick = () => {
        activeCat = activeCat === c.code ? "" : c.code;
        renderCats(); renderResults();
      };
      host.appendChild(chip);
    });
  }

  function renderResults() {
    const q = $("#search").value.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const host = $("#results");
    host.innerHTML = "";
    let matches = [];
    DATA.models.forEach((m, i) => {
      if (activeCat && m.category !== activeCat) return;
      const score = tokens.length ? scoreModel(i, tokens) : 0;
      if (score >= 0) matches.push({ m, score, i });
    });
    if (!matches.length) {
      host.appendChild(el("div", "picker-empty",
        "No products match. Try a model number (MS 271), SKU, or UPC."));
      return;
    }
    matches.sort((a, b) => b.score - a.score || a.i - b.i);
    matches = matches.slice(0, 120).map(x => x.m);
    const showHeaders = tokens.length === 0;
    let lastCat = null;
    matches.forEach(m => {
      if (showHeaders && m.categoryName !== lastCat) {
        lastCat = m.categoryName;
        host.appendChild(el("div", "result-cat", m.categoryName));
      }
      const r = el("div", "result" + (m.id === selectedId ? " active" : ""));
      const prices = m.variants.map(v => v.msrp);
      const pmin = Math.min.apply(null, prices);
      const title = el("div", "r-model");
      const dot = el("span", "spec-dot " + specCompleteness(m));
      dot.title = { full: "Specs complete", partial: "Specs partially filled", none: "No specs yet" }[specCompleteness(m)];
      title.appendChild(dot);
      title.appendChild(document.createTextNode(m.model + " "));
      if (m.nickname) title.appendChild(el("span", "nick", m.nickname));
      title.appendChild(el("span", "r-price", "$" + pmin.toFixed(2) + (prices.length > 1 ? "+" : "")));
      r.appendChild(title);
      r.appendChild(el("div", "r-meta",
        m.categoryName + " · " + m.variants.length +
        (m.variants.length === 1 ? " configuration" : " configurations")));
      r.onclick = () => { selectedId = m.id; refresh(true); renderResults(); };
      const inQ = queue.indexOf(m.id) !== -1;
      const qBtn = el("button", "r-queue-add" + (inQ ? " added" : ""), inQ ? "✓" : "+");
      qBtn.title = inQ ? "Remove from print queue" : "Add to print queue";
      qBtn.onclick = (e) => {
        e.stopPropagation();
        queue.indexOf(m.id) === -1 ? queueAdd(m.id) : queueRemove(m.id);
        renderResults();
      };
      r.appendChild(qBtn);
      host.appendChild(r);
    });
  }

  /* ---------------- dealer price file import ----------------
     Reads the CSV export STIHL sends ("Dealer Price File …") and rebuilds
     the product dataset in the browser, so pricing stays current without
     touching the app. Mirrors tools/build_data.py — keep the two in sync.
     Dealer cost is read but never stored. */

  const UNIT_CATEGORIES = {
    "0CS": ["Gas Chain Saws", "GAS CHAIN SAW"],
    "0LB": ["Battery Chain Saws", "BATTERY CHAIN SAW"],
    "0KM": ["Kombi Powerheads", "KOMBI SYSTEM"],
    "0TR": ["Trimmers & Brushcutters", "TRIMMER / BRUSHCUTTER"],
    "0TS": ["Cut-Off Machines", "CUT-OFF MACHINE"],
    "1BB": ["Backpack Blowers", "BACKPACK BLOWER"],
    "1BH": ["Handheld Blowers", "HANDHELD BLOWER"],
    "1HB": ["Battery Hedge Trimmers", "BATTERY HEDGE TRIMMER"],
    "1HS": ["Hedge Trimmers", "HEDGE TRIMMER"],
    "1HT": ["Pole Pruners", "POLE PRUNER"],
    "1IN": ["Industrial / Augers", "EARTH AUGER"],
    "1IB": ["Battery Sprayers", "BATTERY SPRAYER"],
    "1LB": ["Battery Units", "BATTERY POWER TOOL"],
    "1MM": ["Multi-Machines", "YARD BOSS MULTI-SYSTEM"],
    "1RB": ["Pressure Washers", "PRESSURE WASHER"],
    "1RM": ["Gas Lawn Mowers", "GAS LAWN MOWER"],
    "1RZ": ["Front Mowers", "FRONT MOWER"],
    "1SE": ["Wet/Dry Vacuums", "WET/DRY VACUUM"],
    "1ZB": ["Battery Front Mowers", "BATTERY FRONT MOWER"],
    "0ES": ["Electric Chain Saws", "ELECTRIC CHAIN SAW"],
    "0GS": ["Concrete Cutters", "CONCRETE CUTTER"],
    "3TT": ["Kombi Attachments", "KOMBI ATTACHMENT"],
    "3MA": ["Yard Boss Attachments", "YARD BOSS ATTACHMENT"]
  };

  // Attachment rows are 'XX-KM …' / 'XX-MM …'; the rest are spare parts.
  const ATTACHMENT_RE = /^[A-Z]{2,3}-[KM]M\b/;

  // Pro saws and some newer battery tools ship as powerhead "kits" (9KP) or
  // under one-off codes; resolve those rows by brand (mirror build_data.py).
  const KIT_CATEGORIES = { "9KP": 1, "0CB": 1, "0KB": 1, "0TB": 1, "1PB": 1, "1SB": 1 };
  const BRAND_CATEGORY = {
    MS: "0CS", MSA: "0LB", MSE: "0ES", GS: "0GS",
    HLA: "1HB", HL: "1HS", MM: "1MM", RMA: "1LB", RZA: "1LB",
    KMA: "0KM", KM: "0KM", FSA: "0TR", FS: "0TR",
    HTA: "1HT", HT: "1HT", HSA: "1HB", HS: "1HS",
    SEA: "1SE", SE: "1SE", SGA: "1IB",
    BGA: "1BH", BG: "1BH", BRA: "1BB", BR: "1BB"
  };

  function resolveCategory(cat, desc) {
    const brand = (desc.split(/\s+/)[0] || "");
    if (cat === "3TT" || cat === "3MA") {
      return ATTACHMENT_RE.test(desc) ? cat : null;
    }
    if (UNIT_CATEGORIES[cat]) {
      if (cat === "0CS" && brand === "MSA") return "0LB"; // dealer-file misfile
      return cat;
    }
    if (KIT_CATEGORIES[cat]) return BRAND_CATEGORY[brand] || null;
    return null;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const BRAND_RE = /^i?[A-Z]{2,4}$/;
  const NUM_TOKEN_RE = /^\d+(\.\d+)?[a-z]?(-[A-Z])?$/;
  const SUFFIX_RE = /^([A-Z]{1,3}(-[A-Z]{1,3})?|SET|PLUS|CONTROL|EVO)$/;
  const SKIP_TOKENS = { "(USA)": 1, "1/4": 1, "3/8": 1, "in.P": 1, "in.": 1,
                        "Z": 1, "P": 1, "SPUR": 1, "RIM": 1 };
  const TYPE_RE = new RegExp("\\s*(" + [
    "Chainsaw", "Cordless chain saw", "Chain saw", "Brushcutter", "Edger",
    "CombiEngine", "Cordless KombiMotor", "Pole pruner", "Hedge trimmer",
    "Hedgetrimmer", "Cordless hedge trimmer", "Cordless Hedgetrimmer",
    "Blower", "Cordless Blower", "Mistblower", "Shredder/Vacuum",
    "Cut-off machine", "Cordless cut-off machine", "Earth auger",
    "Hand held drill", "Cordless trimmer", "Cordless sweeper",
    "Cordless sprayer", "Electric Trimmer", "Electric Blower",
    "Electric hedge trimmer", "Robotic mower", "Cordless lawn mower",
    "Lawn mower", "High-pressure washer", "High-pressure cleaner",
    "Vacuums", "yard boss MultiEngine", "Magnum Blower",
    "CHAINSAW", "Electric saw", "Concrete cutter", "MultiEngine",
    "CORDLESS KOMBIMOTO", "CORDLESS TRIMMER", "Cordless Pole pruner",
    "Chains\\b", "Scythe", "Bed-Redefiner", "Scrub cutter",
    "Sweeper drum assembly", "Bristle brush", "Cultivator", "Aerator",
    "Bolo tines", "Dethatcher", "Axial blower", "Trimmer"
  ].join("|") + ")");
  const BAR_LEN_RE = /(\d+)\s*(?:cm|mm)\/(\d+)\s*in/i;
  const BAR_ALT_RE = /Chainsaw\s+(\d{2})-/i;
  const CHAIN_CODE_RE = /\b(\d{2}\s?(?:RS|RM|RH|PM|PMM|PS|PD)[A-Z0-9]{0,3})\b/;
  const NICKNAME_RE = /(Farm Boss|Wood Boss|Magnum|Yard Boss|Dirt Boss)/i;
  // marketing names confirmed by the Dealer Support Manual where retail
  // descriptions don't carry them (keep in sync with tools/build_data.py)
  const NICKNAME_BY_MODEL = { "MS 251": "WOOD BOSS", "RB 400": "DIRT BOSS" };

  function dashPart(material) {
    return material.replace(/ US$/, "").trim().replace(/\s+/g, "-");
  }

  function extractModel(head) {
    const tokens = head.split(/\s+/);
    if (tokens.length < 2 || !BRAND_RE.test(tokens[0]) || !NUM_TOKEN_RE.test(tokens[1])) {
      return head;
    }
    const kept = tokens.slice(0, 2);
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i].replace(/-A?Z$/, ""); // 'T-Z' -> 'T'
      if (!t || SKIP_TOKENS[t]) continue;
      if (/^\d+$/.test(t)) break;      // bare integer = size spec
      if (t === kept[kept.length - 1]) break; // repeated suffix = spec text
      if (SUFFIX_RE.test(t) || NUM_TOKEN_RE.test(t)) { kept.push(t); continue; }
      break;
    }
    kept[1] = kept[1].replace(/-A?Z$/, ""); // 'MS 311-Z'
    return kept.join(" ");
  }

  function parseUnitDesc(desc) {
    const m = TYPE_RE.exec(desc);
    let head = m ? desc.slice(0, m.index) : desc;
    const ptype = m ? m[1] : "";
    const tail = m ? desc.slice(m.index + m[0].length) : "";
    head = head.trim().replace(/,+$/, "");
    head = head.replace(/[- ]RZ\b/, " R"); // wrap-handle: 'MS 462-RZ' -> R model
    head = head.replace(/[- ](?:A?Z|LZ)$/, "").trim();
    const model = extractModel(head);
    const bm = BAR_LEN_RE.exec(desc);
    const am = BAR_ALT_RE.exec(desc);
    const barIn = bm ? parseInt(bm[2], 10) : (am ? parseInt(am[1], 10) : null);
    const cm = CHAIN_CODE_RE.exec(tail);
    let chain = null;
    if (cm) chain = cm[1].replace(/\s/g, "").replace(/^(\d{2})/, "$1 ");
    return { model, ptype, barIn, chain };
  }

  function buildDatasetFromCSV(text, fileName) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error("The file appears to be empty.");
    const header = rows[0].map(h => h.replace(/^﻿/, "").trim());
    const col = {};
    header.forEach((h, i) => { col[h] = i; });
    const need = ["STIHL Material Number", "Material Description", "MSRP", "Category"];
    for (const n of need) {
      if (col[n] === undefined) {
        throw new Error('This doesn\'t look like a STIHL dealer price file — missing the "' + n + '" column.');
      }
    }
    const iMat = col["STIHL Material Number"], iDesc = col["Material Description"],
          iMsrp = col["MSRP"], iUpc = col["UPC"], iAce = col["ACE SKU"],
          iCat = col["Category"];

    // knowledge carried over from the bundled build (master SKU listing joins)
    const retailByUpc = {}, chainByPart = {};
    BUNDLED.models.forEach(m => m.variants.forEach(v => {
      if (v.upc) retailByUpc[v.upc] = { retail: v.retail, status: v.status };
    }));
    BUNDLED.chains.forEach(c => { chainByPart[c.part] = c; });

    const groups = {}, bars = [];
    const chains = BUNDLED.chains.slice();
    let unitRows = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const mat = (row[iMat] || "").trim();
      const desc = (row[iDesc] || "").trim();
      const msrp = parseFloat((row[iMsrp] || "").trim());
      const upc = iUpc === undefined ? "" : (row[iUpc] || "").trim();
      const ace = iAce === undefined ? "" : (row[iAce] || "").trim();
      const cat = (row[iCat] || "").trim();
      if (!mat || isNaN(msrp) || msrp <= 0) continue;

      if (cat === "2BR") {
        const bm = BAR_LEN_RE.exec(desc);
        bars.push({ part: dashPart(mat), desc, lengthIn: bm ? parseInt(bm[2], 10) : null,
                    msrp, aceSku: ace });
        continue;
      }
      if (cat === "2CL") {
        const part = dashPart(mat);
        if (!chainByPart[part]) {
          const fm = CHAIN_CODE_RE.exec(desc);
          const c = { marketing: fm ? fm[1] : "", part, desc, aceSku: ace, upc };
          chainByPart[part] = c;
          chains.push(c);
        }
        continue;
      }
      const rcat = resolveCategory(cat, desc);
      if (!rcat) continue;

      unitRows++;
      const p = parseUnitDesc(desc);
      const master = retailByUpc[upc] || {};
      const retail = master.retail || "";
      if (p.barIn === null && (cat === "0CS" || cat === "0LB")) {
        const rm = /\b(\d{2})\s?in\b/.exec(retail);
        if (rm && +rm[1] >= 10 && +rm[1] <= 36) p.barIn = +rm[1];
      }
      const nick = NICKNAME_RE.exec(retail + " " + desc);
      const key = rcat + ":" + p.model;
      if (!groups[key]) {
        groups[key] = {
          id: key, model: p.model,
          nickname: nick ? nick[1].toUpperCase() : "",
          category: rcat,
          categoryName: UNIT_CATEGORIES[rcat][0],
          signCategory: UNIT_CATEGORIES[rcat][1],
          productType: p.ptype, variants: []
        };
      }
      if (nick && !groups[key].nickname) groups[key].nickname = nick[1].toUpperCase();
      groups[key].variants.push({
        material: mat, materialDash: dashPart(mat), desc, retail,
        barIn: p.barIn, chain: p.chain, msrp,
        upc, aceSku: ace, status: master.status || ""
      });
    }

    if (unitRows === 0) {
      throw new Error("No power tool units found in the file — is this the right export?");
    }
    const models = Object.values(groups)
      .sort((a, b) => (a.category + a.model).localeCompare(b.category + b.model));
    models.forEach(g => {
      g.variants.sort((a, b) => (a.barIn || 999) - (b.barIn || 999) || a.msrp - b.msrp);
      if (!g.nickname && NICKNAME_BY_MODEL[g.model]) g.nickname = NICKNAME_BY_MODEL[g.model];
    });

    // display date pulled from STIHL's file name, e.g. …_07_01_2026_10_47_56_AM.csv
    const dm = /(\d{2})_(\d{2})_(\d{4})/.exec(fileName || "");
    return {
      categories: BUNDLED.categories,
      models,
      chains,
      bars: bars.sort((a, b) => (a.lengthIn || 0) - (b.lengthIn || 0)),
      meta: {
        source: "import",
        fileName: fileName || "dealer price file",
        fileDate: dm ? dm[1] + "/" + dm[2] + "/" + dm[3] : ""
      }
    };
  }

  function countPriceChanges(oldData, newData) {
    const old = {};
    oldData.models.forEach(m => m.variants.forEach(v => { old[v.materialDash] = v.msrp; }));
    let changed = 0, added = 0;
    newData.models.forEach(m => m.variants.forEach(v => {
      if (old[v.materialDash] === undefined) added++;
      else if (old[v.materialDash] !== v.msrp) changed++;
    }));
    return { changed, added };
  }

  // Imported data replaces file-derived fields, so stale manual overrides of
  // price/SKU/UPC are dropped; spec edits and chain/bar picks are kept.
  function clearFileFieldOverrides() {
    Object.keys(overrides).forEach(id => {
      const o = overrides[id];
      delete o.price; delete o.sku; delete o.upc; delete o.config;
      if (o.side) {
        Object.keys(o.side).forEach(mat => {
          delete o.side[mat].price; delete o.side[mat].sku; delete o.side[mat].label;
        });
      }
    });
    saveOverrides();
  }

  function renderDataStatus(extra) {
    const host = $("#data-status");
    host.innerHTML = "";
    const meta = DATA.meta || {};
    const nUnits = DATA.models.reduce((n, m) => n + m.variants.length, 0);
    const b = el("b", "", meta.source === "import"
      ? "Pricing: " + (meta.fileDate ? "dealer file " + meta.fileDate : meta.fileName)
      : "Pricing: bundled dealer file 07/01/2026");
    host.appendChild(b);
    host.appendChild(document.createTextNode(" · " + nUnits + " power tools"));
    if (extra) {
      host.appendChild(el("div", "", extra));
    }
    if (meta.source === "import") {
      const a = el("a", "", "revert to bundled data");
      a.onclick = () => {
        localStorage.removeItem(LS_DATA_KEY);
        adoptDataset(BUNDLED);
        pruneQueue(); renderQueue();
        renderDataStatus();
        renderCats(); renderResults();
        if (selectedId && !modelById[selectedId]) selectedId = null;
        if (selectedId) refresh(true);
      };
      host.appendChild(document.createTextNode(" · "));
      host.appendChild(a);
    }
  }

  function importPriceFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const fresh = buildDatasetFromCSV(String(reader.result), file.name);
        const diff = countPriceChanges(DATA, fresh);
        let note = "";
        try {
          localStorage.setItem(LS_DATA_KEY, JSON.stringify(fresh));
        } catch (e) {
          note = " (too large to save — active this session only)";
        }
        clearFileFieldOverrides();
        adoptDataset(fresh);
        pruneQueue(); renderQueue();
        if (selectedId && !modelById[selectedId]) selectedId = null;
        renderDataStatus("Imported " + file.name + ": " + diff.changed +
          " price change" + (diff.changed === 1 ? "" : "s") +
          (diff.added ? ", " + diff.added + " new" : "") + note);
        renderCats(); renderResults();
        if (selectedId) refresh(true);
      } catch (err) {
        renderDataStatus("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- print queue ---------------- */
  const LS_QUEUE_KEY = "signshop.queue.v1";
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "[]"); } catch (e) {}

  const saveQueue = () => localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(queue));

  // Drop queued ids that no longer exist in the loaded dataset (e.g. after
  // a price file import). Call once modelById is populated.
  function pruneQueue() {
    const before = queue.length;
    queue = queue.filter(id => modelById[id]);
    if (queue.length !== before) saveQueue();
  }

  function queueAdd(id) {
    if (queue.indexOf(id) !== -1) return;
    queue.push(id);
    saveQueue();
    renderQueue();
  }
  function queueRemove(id) {
    queue = queue.filter(x => x !== id);
    saveQueue();
    renderQueue();
  }
  function queueClear() {
    queue = [];
    saveQueue();
    renderQueue();
  }

  function queueLabel(model) {
    return model.model + (model.nickname ? " " + model.nickname : "");
  }

  function renderQueue() {
    $("#queue-count").textContent = queue.length;
    $("#btn-queue-export").disabled = queue.length === 0;

    const addBtn = $("#btn-queue-add");
    const inQ = selectedId && queue.indexOf(selectedId) !== -1;
    addBtn.disabled = !selectedId;
    addBtn.textContent = inQ ? "✓ IN QUEUE" : "+ ADD TO QUEUE";

    const list = $("#queue-list");
    list.innerHTML = "";
    if (!queue.length) {
      list.appendChild(el("div", "queue-empty",
        "No signs queued yet — hover a search result and click + , or add the sign you're editing."));
      return;
    }
    queue.forEach(id => {
      const model = modelById[id];
      if (!model) return;
      const cfg = current(model);
      const item = el("div", "queue-item");
      item.appendChild(el("span", "qi-name", queueLabel(model)));
      item.appendChild(el("span", "qi-cfg", cfg.config));
      const rm = el("button", "", "✕");
      rm.title = "Remove from queue";
      rm.onclick = () => queueRemove(id);
      item.appendChild(rm);
      list.appendChild(item);
    });
  }

  function setQueueStatus(msg, isErr) {
    const s = $("#queue-status");
    if (!msg) { s.hidden = true; s.textContent = ""; return; }
    s.hidden = false;
    s.textContent = msg;
    s.classList.toggle("err", !!isErr);
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  }

  async function exportQueueZip() {
    if (!queue.length) return;
    const ids = queue.filter(id => modelById[id]);
    const missing = queue.length - ids.length;
    const btnExport = $("#btn-queue-export"), btnClear = $("#btn-queue-clear");
    btnExport.disabled = true; btnClear.disabled = true;
    const priorSelected = selectedId;

    try {
      await document.fonts.ready;
      const zip = new JSZip();
      const usedNames = {};
      for (let i = 0; i < ids.length; i++) {
        const model = modelById[ids[i]];
        setQueueStatus("Rendering " + (i + 1) + " of " + ids.length + " — " + queueLabel(model) + "…");
        renderSign(model, current(model));
        // let layout/fonts/images settle before rasterizing
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await html2canvas($("#sign"), {
          scale: 4, backgroundColor: "#ffffff", useCORS: true, logging: false
        });
        const imgData = canvas.toDataURL("image/png");
        const pdf = new window.jspdf.jsPDF({ unit: "in", format: [5, 3], orientation: "landscape" });
        pdf.addImage(imgData, "PNG", 0, 0, 5, 3, undefined, "FAST");
        const blob = pdf.output("blob");

        let name = sanitizeFilename(queueLabel(model)) + ".pdf";
        if (usedNames[name] !== undefined) {
          usedNames[name]++;
          name = sanitizeFilename(queueLabel(model)) + " (" + usedNames[name] + ").pdf";
        } else {
          usedNames[name] = 0;
        }
        zip.file(name, blob);
      }

      setQueueStatus("Zipping " + ids.length + " sign" + (ids.length === 1 ? "" : "s") + "…");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = "STIHL-signs-" + stamp + ".zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);

      setQueueStatus("Done — " + ids.length + " sign" + (ids.length === 1 ? "" : "s") + " exported" +
        (missing ? " (" + missing + " no longer in the current data, skipped)" : "") + ".");
    } catch (err) {
      setQueueStatus("Export failed: " + err.message, true);
    } finally {
      btnExport.disabled = queue.length === 0;
      btnClear.disabled = false;
      if (priorSelected && modelById[priorSelected]) {
        selectedId = priorSelected;
        refresh(true);
      }
    }
  }

  $("#btn-queue-add").addEventListener("click", () => {
    if (!selectedId) return;
    queue.indexOf(selectedId) === -1 ? queueAdd(selectedId) : queueRemove(selectedId);
    renderResults();
  });
  $("#btn-queue-toggle").addEventListener("click", () => {
    const panel = $("#queue-panel");
    panel.hidden = !panel.hidden;
  });
  $("#btn-queue-close").addEventListener("click", () => { $("#queue-panel").hidden = true; });
  $("#btn-queue-clear").addEventListener("click", () => { queueClear(); renderResults(); });
  $("#btn-queue-export").addEventListener("click", () => { setQueueStatus(""); exportQueueZip(); });

  /* ---------------- preview scale & print ---------------- */
  function fitPreview() {
    const wrap = $(".preview-wrap");
    const scaler = $("#preview-scaler");
    const avail = wrap.clientWidth - 56;
    const scale = Math.min(2.2, Math.max(1, avail / 480));
    scaler.style.transform = "scale(" + scale + ")";
    scaler.style.height = 288 * scale + "px";
    scaler.style.width = 480 + "px";
  }

  function printSign() {
    if (!selectedId) return;
    let host = $(".sign-print-host");
    if (!host) {
      host = el("div", "sign-print-host");
      document.body.appendChild(host);
    }
    host.innerHTML = "";
    host.appendChild($("#sign").cloneNode(true));
    window.print();
  }

  /* ---------------- refresh ---------------- */
  function refresh(fullEditor) {
    const model = modelById[selectedId];
    if (!model) return;
    const cfg = current(model);
    renderSign(model, cfg);
    if (fullEditor) renderEditor(model, cfg);
    $("#btn-print").disabled = false;
    renderQueue();
  }

  /* ---------------- boot ---------------- */
  $("#search").addEventListener("input", renderResults);
  $("#btn-print").addEventListener("click", printSign);
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) importPriceFile(e.target.files[0]);
    e.target.value = "";
  });
  window.addEventListener("resize", fitPreview);
  window.addEventListener("afterprint", () => {
    const host = $(".sign-print-host");
    if (host) host.innerHTML = "";
  });

  (function loadDataset() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(LS_DATA_KEY) || "null"); } catch (e) {}
    adoptDataset(stored && stored.models && stored.models.length ? stored : BUNDLED);
  })();

  pruneQueue();
  renderDataStatus();
  renderCats();
  renderResults();
  renderQueue();
  fitPreview();

  // When run from the SignShop launcher (served on localhost), heartbeat so
  // the launcher can exit once every app tab has closed.
  if (location.protocol === "http:" && location.hostname === "localhost") {
    setInterval(() => { fetch("/__ping").catch(() => {}); }, 2000);
  }

  // Deep link: #model=0CS:MS 271
  const hash = decodeURIComponent(location.hash.replace(/^#model=/, ""));
  if (hash && modelById[hash]) { selectedId = hash; refresh(true); renderResults(); }
})();
