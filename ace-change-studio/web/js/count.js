/* ============================================================
   Ace Change Studio — Count Drawer view.

   Pick a drawer → type how many of each bill/coin is in it → the app
   shows exactly what to leave for the $150 reset (as a till tray) and
   what to pull, then compares the pull to the register's number.
   ============================================================ */
"use strict";

const COUNT_DRAFT_KEY = "acs.countDraft";

const CountView = {
  s: null, // working count (see blankCount)

  blank(keep) {
    return {
      drawerId: null,
      counts: {},
      // "n" = count coins, "$" = type a dollar amount; remembered between counts
      coinMode: keep && keep.coinMode ? Object.assign({}, keep.coinMode) : { cq: "n", cd: "n", cn: "n" },
      coinDollars: {},
      expected: "",
      cashier: "",
      counter: keep ? keep.counter : "",
      date: keep ? keep.date : todayISO(),
      note: "",
      editingId: null,
    };
  },

  init() {
    this.s = this.loadDraft() || this.blank();
    const v = $("#view-count");
    v.innerHTML = `
      <div class="view-head">
        <div>
          <h2>Count a drawer</h2>
          <p>Pick the drawer, type what's in it, and you'll see exactly what to leave for the reset and what to pull.</p>
        </div>
      </div>
      <div class="edit-banner" id="cEditBanner"></div>
      <div class="drawer-picker" id="drawerPicker"></div>
      <div class="count-layout">
        <div class="card count-card">
          <div class="who-row">
            <label class="who"><span>${icon("user")} Cashier</span><select class="f-input" id="cCashier"></select></label>
            <label class="who"><span>${icon("check")} Counted by</span><select class="f-input" id="cCounter"></select></label>
            <label class="who narrow"><span>${icon("cal")} Date</span><input type="date" class="f-input" id="cDate"></label>
          </div>
          <div id="cRows"></div>
          <div class="card-foot">
            <span class="f-help">Tip: press <kbd>Enter</kbd> to jump to the next box.</span>
            <button class="btn btn-ghost" id="cClear">${icon("refresh")} Start over</button>
          </div>
        </div>
        <aside class="card result-card" id="cResult"></aside>
      </div>`;

    this.renderRows();
    $("#cDate").value = this.s.date;
    $("#cDate").onchange = () => { this.s.date = $("#cDate").value || todayISO(); this.saveDraft(); };
    $("#cClear").onclick = () => this.clear(true);
    for (const id of ["cCashier", "cCounter"]) {
      $("#" + id).onchange = async (e) => {
        const sel = e.target;
        if (sel.value === "__add") {
          const name = await addPersonFlow();
          this.fillPeople();
          sel.value = name || "";
        }
        this.s.cashier = $("#cCashier").value;
        this.s.counter = $("#cCounter").value;
        this.saveDraft();
      };
    }
    this.refresh();
  },

  /* Called when settings or history change. */
  refresh() {
    if (!this.s) return;
    if (this.s.drawerId && !Store.drawer(this.s.drawerId)) this.s.drawerId = null;
    this.renderPicker();
    this.fillPeople();
    this.renderRows(true);
    this.renderResult();
    this.renderEditBanner();
  },

  renderPicker() {
    const host = $("#drawerPicker");
    const drawers = Store.settings.drawers;
    const areas = [...new Set(drawers.map((d) => d.area || "Drawers"))];
    host.innerHTML = "";
    for (const area of areas) {
      const g = el("div", "picker-group");
      g.appendChild(el("div", "picker-area", esc(area)));
      const row = el("div", "picker-row");
      for (const d of drawers.filter((x) => (x.area || "Drawers") === area)) {
        const last = lastCountFor(d.id);
        const t = el("button", "drawer-tile" + (this.s.drawerId === d.id ? " active" : ""));
        t.dataset.drawer = d.id;
        t.innerHTML = `
          <span class="dt-icon">${d.id === "swap" || /swap/i.test(d.name) ? icon("swap") : icon("drawer")}</span>
          <span class="dt-name">${esc(d.name)}</span>
          ${d.note ? `<span class="dt-note">${esc(d.note)}</span>` : `<span class="dt-note">Starts at ${Cash.money(d.start, { noCents: true })}</span>`}
          <span class="dt-last">${last ? `${esc(fmtDate(last.date, { month: "short", day: "numeric" }))} ${osBadge(last.overShortCents, Store.settings.flags)}` : `<span class="muted">Not counted yet</span>`}</span>`;
        t.onclick = () => { this.s.drawerId = d.id; this.saveDraft(); this.renderPicker(); this.renderResult(); };
        row.appendChild(t);
      }
      g.appendChild(row);
      host.appendChild(g);
    }
  },

  fillPeople() {
    const people = Store.settings.people;
    for (const [id, key, ph] of [["cCashier", "cashier", "Who worked it?"], ["cCounter", "counter", "Who's counting?"]]) {
      const sel = $("#" + id);
      const cur = this.s[key];
      const names = people.slice();
      if (cur && !names.includes(cur)) names.push(cur); // a name since removed from Settings
      sel.innerHTML = `<option value="">${ph}</option>` + names.map((p) => `<option ${p === cur ? "selected" : ""}>${esc(p)}</option>`).join("") + `<option value="__add">＋ Add a name…</option>`;
    }
  },

  renderRows(valuesOnly) {
    const host = $("#cRows");
    if (!valuesOnly || !host.children.length) {
      const sections = [
        ["Bills", ["b1", "b5", "b10", "b20", "b50", "b100"]],
        ["Coin rolls", ["rq", "rd", "rn"]],
        ["Loose coins", ["cq", "cd", "cn"]],
      ];
      host.innerHTML = sections.map(([title, ids]) => `
        <div class="count-section">
          <h3>${title}</h3>
          ${ids.map((id) => this.rowHTML(id)).join("")}
        </div>`).join("");
      $$(".c-row", host).forEach((row) => {
        const id = row.dataset.id;
        const inp = $("input.cnt", row);
        wireNumberInput(inp, () => {
          if (this.isDollarMode(id)) this.s.coinDollars[id] = inp.value;
          else this.s.counts[id] = inp.value === "" ? "" : parseInt(inp.value, 10);
          this.afterEdit(id);
        }, { decimal: this.isDollarMode(id) });
        $$(".step", row).forEach((b) => (b.onclick = () => {
          const delta = Number(b.dataset.step);
          if (this.isDollarMode(id)) return;
          const n = Math.max(0, (parseInt(this.s.counts[id], 10) || 0) + delta);
          this.s.counts[id] = n;
          inp.value = n || "";
          this.afterEdit(id);
        }));
        const mode = $(".mode-toggle", row);
        if (mode) mode.onclick = () => {
          this.s.coinMode[id] = this.isDollarMode(id) ? "n" : "$";
          this.renderRows();
          this.renderResult();
          $(`.c-row[data-id="${id}"] input.cnt`).focus();
        };
      });
    }
    for (const d of Cash.DRAWER_DENOMS) this.updateRowValue(d.id);
  },

  isCoin(id) { return Cash.DENOM[id].kind === "coin"; },
  isDollarMode(id) { return this.isCoin(id) && this.s.coinMode[id] === "$"; },

  rowHTML(id) {
    const d = Cash.DENOM[id];
    const dollar = this.isDollarMode(id);
    const each = d.kind === "roll" ? `${d.per} coins · ${Cash.money(d.cents, { noCents: true })} a roll` : d.kind === "coin" ? `${d.cents}¢ each` : "";
    const val = dollar ? (this.s.coinDollars[id] || "") : (this.s.counts[id] || "");
    return `
      <div class="c-row ${dollar ? "dollar" : ""}" data-id="${id}">
        <span class="c-pic">${moneyPic(id)}</span>
        <span class="c-label"><b>${d.label}</b>${each ? `<small>${each}</small>` : ""}</span>
        <span class="stepper">
          <button class="step" data-step="-1" tabindex="-1" title="One less" ${dollar ? "disabled" : ""}>${icon("minus")}</button>
          <span class="cnt-wrap">${dollar ? '<span class="cnt-prefix">$</span>' : ""}<input class="cnt" value="${esc(val)}" placeholder="0" aria-label="${d.label}"></span>
          <button class="step" data-step="1" tabindex="-1" title="One more" ${dollar ? "disabled" : ""}>${icon("plus")}</button>
        </span>
        ${this.isCoin(id) ? `<button class="mode-toggle" tabindex="-1" title="Switch between counting coins and typing a dollar amount">${dollar ? "# count" : "$ amount"}</button>` : '<span class="mode-spacer"></span>'}
        <span class="c-value" id="cv-${id}"></span>
      </div>`;
  },

  /* Coin dollar mode → a coin count (null when the amount isn't a whole number of coins). */
  coinCountFromDollars(id) {
    const cents = Cash.parseMoney(this.s.coinDollars[id]);
    if (cents == null || cents <= 0) return 0;
    const each = Cash.DENOM[id].cents;
    return cents % each === 0 ? cents / each : null;
  },

  effectiveCounts() {
    const c = {};
    for (const d of Cash.DRAWER_DENOMS) {
      if (this.isDollarMode(d.id)) {
        const n = this.coinCountFromDollars(d.id);
        c[d.id] = n == null ? 0 : n;
      } else c[d.id] = parseInt(this.s.counts[d.id], 10) || 0;
    }
    return c;
  },

  updateRowValue(id) {
    const out = $("#cv-" + id);
    if (!out) return;
    const d = Cash.DENOM[id];
    if (this.isDollarMode(id)) {
      const n = this.coinCountFromDollars(id);
      if (n == null) out.innerHTML = `<span class="bad-text">not a whole number of ${d.label.toLowerCase()}</span>`;
      else out.innerHTML = n ? `<span class="muted">${n} coins</span>` : "";
      return;
    }
    const n = parseInt(this.s.counts[id], 10) || 0;
    out.textContent = n ? Cash.money(n * d.cents) : "";
  },

  afterEdit(id) {
    this.updateRowValue(id);
    this.saveDraft();
    this.renderResult();
  },

  plan() {
    const d = Store.drawer(this.s.drawerId);
    const counts = this.effectiveCounts();
    return { drawer: d, counts, p: Cash.planReset(counts, Store.settings.reset, d ? d.start : 15000) };
  },

  renderResult() {
    const host = $("#cResult");
    const { drawer, counts, p } = this.plan();
    const flags = Store.settings.flags;
    const any = Cash.sumCents(counts) > 0;
    const expected = Cash.parseMoney(this.s.expected);
    const os = expected == null ? null : p.pullCents - expected;

    let warn = "";
    if (any && !p.exact) {
      warn = p.total < p.start
        ? `<div class="notice warn">${icon("alert")}<div><b>This drawer is under its ${Cash.money(p.start, { noCents: true })} start.</b> It has ${Cash.money(p.total)} — ${Cash.money(p.start - p.total)} short — so nothing gets pulled. Leave it all in and top it up from the change box.</div></div>`
        : `<div class="notice warn">${icon("alert")}<div><b>Can't make exactly ${Cash.money(p.start, { noCents: true })} from what's here.</b> The closest is ${Cash.money(p.leaveCents)} (${Cash.money(p.shortCents)} short). Swap a big bill for smaller ones from the change box, then recount.</div></div>`;
    }

    host.innerHTML = `
      <div class="res-head">
        <div class="res-drawer">${drawer ? `${icon("drawer")} ${esc(drawer.name)}` : `<span class="muted">No drawer picked yet</span>`}</div>
        <div class="hero-label">Counted in the drawer</div>
        <div class="hero" id="cTotal">${Cash.money(p.total)}</div>
      </div>
      <div class="split-bar" title="What stays vs. what gets pulled">
        <span class="sb-leave" style="flex:${Math.max(p.leaveCents, 1)}"></span>
        <span class="sb-pull" style="flex:${Math.max(p.pullCents, any ? 1 : 0)}"></span>
      </div>
      <div class="split-legend"><span><i class="k-leave"></i>Leave ${Cash.money(p.leaveCents)}</span><span><i class="k-pull"></i>Pull ${Cash.money(p.pullCents)}</span></div>
      ${warn}
      <div class="res-sec">
        <div class="res-title">Leave in the drawer <b>${Cash.money(p.leaveCents)}</b></div>
        ${trayHTML(p.leave, any)}
      </div>
      <div class="res-sec">
        <div class="res-title">Pull for the deposit <b id="cPull">${Cash.money(p.pullCents)}</b></div>
        ${pullListHTML(p.pull, any)}
      </div>
      <div class="res-sec register">
        <label class="res-title" for="cExpected">The register says to pull</label>
        <div class="money-input"><span>$</span><input id="cExpected" class="f-input" inputmode="decimal" placeholder="0.00" value="${esc(this.s.expected)}" autocomplete="off"></div>
        <div id="cOS" class="os-result">${os == null ? `<span class="muted">Type the register's number to see if the drawer is over or short.</span>` : osResultHTML(os, flags)}</div>
      </div>
      <textarea id="cNote" class="f-input note" rows="2" placeholder="Note (optional) — e.g. “found a $5 under the tray”">${esc(this.s.note)}</textarea>
      <button class="btn btn-primary btn-block" id="cSave">${icon("save")} ${this.s.editingId ? "Save changes" : "Save count"}</button>`;

    const exp = $("#cExpected");
    exp.addEventListener("input", () => {
      exp.value = exp.value.replace(/[^\d.,$]/g, "");
      this.s.expected = exp.value;
      this.saveDraft();
      const e2 = Cash.parseMoney(exp.value);
      $("#cOS").innerHTML = e2 == null ? `<span class="muted">Type the register's number to see if the drawer is over or short.</span>` : osResultHTML(this.plan().p.pullCents - e2, flags);
    });
    exp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.save(); } });
    $("#cNote").oninput = (e) => { this.s.note = e.target.value; this.saveDraft(); };
    $("#cSave").onclick = () => this.save();
  },

  renderEditBanner() {
    const b = $("#cEditBanner");
    const rec = this.s.editingId && Store.counts.find((c) => c.id === this.s.editingId);
    if (!rec) { this.s.editingId = null; b.classList.remove("show"); return; }
    b.innerHTML = `${icon("edit")} Editing the ${esc(rec.drawerName)} count from ${esc(fmtDateTime(rec.ts))}. <button class="link" id="cCancelEdit">Cancel editing</button>`;
    b.classList.add("show");
    $("#cCancelEdit").onclick = () => this.clear(false);
  },

  async save() {
    const { drawer, counts, p } = this.plan();
    if (!drawer) { showToast("Pick which drawer this is first.", { kind: "error" }); $("#drawerPicker").classList.add("nudge"); setTimeout(() => $("#drawerPicker").classList.remove("nudge"), 700); return; }
    if (Cash.sumCents(counts) === 0) { showToast("Type in what's in the drawer first.", { kind: "error" }); return; }
    const bad = ["cq", "cd", "cn"].find((id) => this.isDollarMode(id) && this.coinCountFromDollars(id) == null);
    if (bad) { showToast(`The ${Cash.DENOM[bad].label.toLowerCase()} amount isn't a whole number of coins.`, { kind: "error" }); return; }
    const expected = Cash.parseMoney(this.s.expected);
    if (expected == null) { showToast("Type in what the register says to pull.", { kind: "error" }); $("#cExpected").focus(); return; }
    if (!this.s.cashier || !this.s.counter) {
      const ok = await confirmBox("Save without names?", `Nobody's picked as the ${!this.s.cashier ? "cashier" : "counter"}. Names make the history more useful — save anyway?`, { okText: "Save anyway", cancelText: "Go back" });
      if (!ok) return;
    }
    const rec = {
      id: this.s.editingId || uid(),
      ts: this.s.editingId ? (Store.counts.find((c) => c.id === this.s.editingId) || {}).ts || Date.now() : Date.now(),
      date: this.s.date || todayISO(),
      drawerId: drawer.id, drawerName: drawer.name, start: drawer.start,
      cashier: this.s.cashier, counter: this.s.counter,
      counts, leave: p.leave, pull: p.pull,
      totalCents: p.total, leaveCents: p.leaveCents, pullCents: p.pullCents,
      expectedCents: expected, overShortCents: p.pullCents - expected,
      exact: p.exact, note: this.s.note.trim(),
    };
    if (this.s.editingId) {
      rec.editedAt = Date.now();
      const i = Store.counts.findIndex((c) => c.id === this.s.editingId);
      if (i >= 0) Store.counts[i] = rec; else Store.counts.push(rec);
    } else Store.counts.push(rec);
    const saved = await Store.save();
    if (!saved) { showToast("Couldn't save — your count is still here. Try again in a moment.", { kind: "error", ms: 8000 }); return; }
    const level = Cash.flagLevel(rec.overShortCents, Store.settings.flags);
    showToast(`${flagIcon(level)} Saved — ${esc(drawer.name)} is ${overShortWord(rec.overShortCents).toLowerCase()}${rec.overShortCents ? " " + Cash.money(Math.abs(rec.overShortCents)) : ""}.`, { kind: level });
    this.clear(false);
    App.refreshAll();
  },

  clear(ask) {
    const go = () => {
      this.s = this.blank(this.s);
      this.saveDraft();
      this.renderRows();
      $("#cDate").value = this.s.date;
      this.refresh();
      window.scrollTo(0, 0);
      $("#work").scrollTop = 0;
    };
    if (ask && Cash.sumCents(this.effectiveCounts()) > 0) {
      confirmBox("Start over?", "This clears what you've typed for this count.", { okText: "Clear it", danger: true }).then((ok) => ok && go());
    } else go();
  },

  /** Load a saved count back into the form to fix it. */
  edit(id) {
    const rec = Store.counts.find((c) => c.id === id);
    if (!rec) return;
    this.s = this.blank();
    Object.assign(this.s, {
      drawerId: rec.drawerId, counts: Object.assign({}, rec.counts),
      expected: (rec.expectedCents / 100).toFixed(2),
      cashier: rec.cashier || "", counter: rec.counter || "", date: rec.date, note: rec.note || "", editingId: rec.id,
    });
    App.show("count");
    this.renderRows();
    $("#cDate").value = this.s.date;
    this.refresh();
  },

  saveDraft() {
    try { localStorage.setItem(COUNT_DRAFT_KEY, JSON.stringify(this.s)); } catch (e) { /* private mode etc. */ }
  },
  loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(COUNT_DRAFT_KEY) || "null");
      if (!d || typeof d !== "object") return null;
      const b = this.blank();
      const s = Object.assign(b, d);
      s.coinMode = Object.assign(b.coinMode, d.coinMode || {});
      if (s.date !== todayISO() && !s.editingId && !Object.values(s.counts || {}).some((n) => n)) s.date = todayISO();
      return s;
    } catch (e) { return null; }
  },
};

function lastCountFor(drawerId) {
  let best = null;
  for (const c of Store.counts) if (c.drawerId === drawerId && (!best || c.date > best.date || (c.date === best.date && c.ts > best.ts))) best = c;
  return best;
}

async function addPersonFlow() {
  const name = await askText("Add a name", { placeholder: "First name or initials", dlg: { body: "Names show up in the cashier and counter lists. You can edit the list in Settings." } });
  if (!name) return "";
  if (!Store.settings.people.includes(name)) {
    Store.settings.people.push(name);
    Store.settings.people.sort((a, b) => a.localeCompare(b));
    await Store.save();
  }
  return name;
}

/* Over/short result block under the register input. */
function osResultHTML(os, flags) {
  const level = Cash.flagLevel(os, flags);
  const msg = level === "good"
    ? (os === 0 ? "Right on the money." : "Close enough — inside the green zone.")
    : level === "warn" ? "Worth a second look before you close it out." : "Recount the drawer and the pull before saving.";
  return `${osBadge(os, flags, { big: true })}<div class="os-msg">${msg}</div>`;
}

/* The till tray: five bill slots over four coin cups. */
function trayHTML(leave, any) {
  const bills = [["b1", "$1"], ["b5", "$5"], ["b10", "$10"], ["b20", "$20"], ["big", "$50+"]];
  const coins = [["cq", "25¢"], ["cd", "10¢"], ["cn", "5¢"], ["rolls", "Rolls"]];
  const n = (id) => {
    if (id === "big") return (leave.b50 || 0) + (leave.b100 || 0);
    if (id === "rolls") return (leave.rq || 0) + (leave.rd || 0) + (leave.rn || 0);
    return leave[id] || 0;
  };
  const cents = (id) => {
    if (id === "big") return (leave.b50 || 0) * 5000 + (leave.b100 || 0) * 10000;
    if (id === "rolls") return (leave.rq || 0) * 1000 + (leave.rd || 0) * 500 + (leave.rn || 0) * 200;
    return (leave[id] || 0) * Cash.DENOM[id].cents;
  };
  const slot = ([id, label], cls) => {
    const k = n(id);
    const extra = id === "rolls" && k ? ["rq", "rd", "rn"].filter((r) => leave[r]).map((r) => `${leave[r]} ${Cash.DENOM[r].short.replace(" roll", "")}`).join(" · ") : "";
    return `<div class="slot ${cls} ${k ? "" : "empty"}" title="${label}: ${k} (${Cash.money(cents(id))})">
      <span class="slot-label">${label}</span>
      <span class="slot-n">${any ? k : "–"}</span>
      <span class="slot-v">${k ? (extra || Cash.money(cents(id))) : ""}</span>
    </div>`;
  };
  return `<div class="tray" aria-label="What to leave in the drawer">
    <div class="tray-row bills">${bills.map((b) => slot(b, "bill-slot")).join("")}</div>
    <div class="tray-row coins">${coins.map((c) => slot(c, "coin-slot")).join("")}</div>
  </div>`;
}

function pullListHTML(pull, any) {
  const rows = Cash.DRAWER_DENOMS.filter((d) => pull[d.id] > 0);
  if (!any) return `<div class="muted small-note">Nothing counted yet.</div>`;
  if (!rows.length) return `<div class="muted small-note">Nothing to pull — everything stays in the drawer.</div>`;
  return `<div class="pull-list">${rows.map((d) => `
    <div class="pull-row">${moneyPic(d.id, "sm")}<span class="pl-n">${pull[d.id]} ×</span><span class="pl-l">${d.label}</span><span class="pl-v">${Cash.money(pull[d.id] * d.cents)}</span></div>`).join("")}
  </div>`;
}
