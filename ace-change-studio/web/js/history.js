/* ============================================================
   Ace Change Studio — History view: summary tiles, a trend chart per
   drawer (small multiples), a month calendar, the by-cashier table,
   and the full logs of drawer counts and change-box orders.

   Over/short marks wear the fixed status colors (good / warning /
   critical) and always carry an icon + label — never color alone.
   ============================================================ */
"use strict";

const HistoryView = {
  f: { range: "30", drawer: "", person: "", day: "" },
  calMonth: null, // Date at the 1st of the shown month

  init() {
    const v = $("#view-history");
    v.innerHTML = `
      <div class="view-head">
        <div>
          <h2>History</h2>
          <p>How far off each drawer has been over time — by drawer, by day, and by cashier.</p>
        </div>
        <button class="btn btn-secondary" id="hExport">${icon("download")} Export CSV</button>
      </div>
      <div class="filter-row">
        <div class="seg" id="hRange">
          ${[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["month", "This month"], ["all", "All time"]].map(([k, l]) => `<button data-r="${k}">${l}</button>`).join("")}
        </div>
        <select class="f-input" id="hDrawer"></select>
        <select class="f-input" id="hPerson"></select>
      </div>
      <div class="tiles" id="hTiles"></div>
      <div class="card">
        <div class="card-head"><h3>Over / short by drawer</h3><span class="f-help" id="hTrendSub"></span></div>
        <div class="multiples" id="hTrends"></div>
      </div>
      <div class="hist-grid">
        <div class="card">
          <div class="card-head"><h3>Calendar</h3>
            <div class="cal-nav"><button class="icon-btn-sm" id="calPrev" title="Previous month">‹</button><b id="calTitle"></b><button class="icon-btn-sm" id="calNext" title="Next month">›</button></div>
          </div>
          <div id="hCal"></div>
          <div class="cal-key">${["good", "warn", "bad"].map((l) => `<span class="os-badge ${l} tiny">${flagIcon(l)}<span>${{ good: "Worst within green", warn: "Yellow", bad: "Red" }[l]}</span></span>`).join("")}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>By cashier</h3><span class="f-help">for the selected range</span></div>
          <div id="hPeople"></div>
        </div>
      </div>
      <div class="card" id="hListCard">
        <div class="card-head"><h3>Drawer counts</h3><span id="hDayChip"></span></div>
        <div id="hList"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Change box counts & orders</h3></div>
        <div id="hBox"></div>
      </div>`;
    $$("#hRange button").forEach((b) => (b.onclick = () => { this.f.range = b.dataset.r; this.f.day = ""; this.render(); }));
    $("#hDrawer").onchange = (e) => { this.f.drawer = e.target.value; this.render(); };
    $("#hPerson").onchange = (e) => { this.f.person = e.target.value; this.render(); };
    $("#calPrev").onclick = () => { this.calMonth.setMonth(this.calMonth.getMonth() - 1); this.renderCalendar(); };
    $("#calNext").onclick = () => { this.calMonth.setMonth(this.calMonth.getMonth() + 1); this.renderCalendar(); };
    $("#hExport").onclick = () => exportCSV();
    const now = new Date();
    this.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this.render();
  },

  refresh() { if ($("#hTiles")) this.render(); },

  /* ---- filtering ---- */
  rangeStart() {
    const r = this.f.range;
    const t = parseISODate(todayISO());
    if (r === "all") return "";
    if (r === "month") return todayISO(new Date(t.getFullYear(), t.getMonth(), 1));
    t.setDate(t.getDate() - (Number(r) - 1));
    return todayISO(t);
  },
  inRange(c) {
    const s = this.rangeStart();
    return !s || c.date >= s;
  },
  filtered(opts) {
    return Store.counts.filter((c) =>
      this.inRange(c) &&
      (!this.f.drawer || c.drawerId === this.f.drawer) &&
      (!this.f.person || c.cashier === this.f.person || (opts && opts.includeCounter && c.counter === this.f.person)) &&
      (!(opts && opts.day) || !this.f.day || c.date === this.f.day)
    ).sort((a, b) => (a.date === b.date ? a.ts - b.ts : a.date < b.date ? -1 : 1));
  },

  render() {
    $$("#hRange button").forEach((b) => b.classList.toggle("active", b.dataset.r === this.f.range));
    const drawers = Store.settings.drawers;
    const knownDrawer = (id) => drawers.some((d) => d.id === id);
    const extraDrawers = [...new Map(Store.counts.filter((c) => !knownDrawer(c.drawerId)).map((c) => [c.drawerId, c.drawerName])).entries()];
    $("#hDrawer").innerHTML = `<option value="">All drawers</option>` + drawers.map((d) => `<option value="${esc(d.id)}" ${this.f.drawer === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("") + extraDrawers.map(([id, name]) => `<option value="${esc(id)}" ${this.f.drawer === id ? "selected" : ""}>${esc(name)} (removed)</option>`).join("");
    const people = [...new Set([...Store.settings.people, ...Store.counts.map((c) => c.cashier).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
    $("#hPerson").innerHTML = `<option value="">All cashiers</option>` + people.map((p) => `<option ${this.f.person === p ? "selected" : ""}>${esc(p)}</option>`).join("");
    this.renderTiles();
    this.renderTrends();
    this.renderCalendar();
    this.renderPeople();
    this.renderList();
    this.renderBox();
  },

  renderTiles() {
    const list = this.filtered();
    const flags = Store.settings.flags;
    const net = list.reduce((t, c) => t + c.overShortCents, 0);
    const avgAbs = list.length ? Math.round(list.reduce((t, c) => t + Math.abs(c.overShortCents), 0) / list.length) : 0;
    const reds = list.filter((c) => Cash.flagLevel(c.overShortCents, flags) === "bad").length;
    const yellows = list.filter((c) => Cash.flagLevel(c.overShortCents, flags) === "warn").length;
    const byDrawer = {};
    for (const c of list) (byDrawer[c.drawerName] = byDrawer[c.drawerName] || []).push(c);
    let worst = null;
    for (const [name, cs] of Object.entries(byDrawer)) {
      const a = cs.reduce((t, c) => t + Math.abs(c.overShortCents), 0) / cs.length;
      if (!worst || a > worst.a) worst = { name, a, n: cs.length };
    }
    const balancedPct = list.length ? Math.round((list.filter((c) => Cash.flagLevel(c.overShortCents, flags) === "good").length / list.length) * 100) : 0;
    const tile = (label, value, sub, cls) => `<div class="tile ${cls || ""}"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-sub">${sub || ""}</div></div>`;
    $("#hTiles").innerHTML = list.length ? [
      tile("Net over / short", `${Cash.money(net, { sign: true })}`, net === 0 ? "evened out" : net > 0 ? "more over than short" : "more short than over", "hero-tile"),
      tile("Counts", String(list.length), `${balancedPct}% in the green`),
      tile("Average miss", Cash.money(avgAbs), "per count, over or short"),
      tile("Flags", `<span class="os-badge bad tiny">${icon("x")}<span>${reds}</span></span> <span class="os-badge warn tiny">${icon("alert")}<span>${yellows}</span></span>`, "red · yellow"),
      tile("Most off", worst ? esc(worst.name) : "—", worst ? `averages ${Cash.money(Math.round(worst.a))} off · ${worst.n} count${worst.n === 1 ? "" : "s"}` : ""),
    ].join("") : `<div class="empty-state wide">${icon("chart", "big-ico")}<p>No drawer counts in this range yet. Counts you save on the <b>Count Drawer</b> tab show up here.</p></div>`;
  },

  renderTrends() {
    const flags = Store.settings.flags;
    const list = this.filtered();
    const start = this.rangeStart() || (list[0] && list[0].date) || todayISO();
    const end = todayISO();
    $("#hTrendSub").textContent = `${fmtDate(start, { month: "short", day: "numeric" })} – ${fmtDate(end, { month: "short", day: "numeric" })} · each bar is one count · ▲ over, ▼ short`;
    const ids = [...new Set([...Store.settings.drawers.map((d) => d.id), ...list.map((c) => c.drawerId)])].filter((id) => !this.f.drawer || id === this.f.drawer);
    // One shared y-scale so the panels compare honestly.
    const maxAbs = Math.max(flags.yellow + 100, ...list.map((c) => Math.abs(c.overShortCents)));
    const host = $("#hTrends");
    host.innerHTML = ids.map((id) => {
      const cs = list.filter((c) => c.drawerId === id);
      const d = Store.drawer(id);
      const name = d ? d.name : (cs[0] && cs[0].drawerName) || id;
      const net = cs.reduce((t, c) => t + c.overShortCents, 0);
      return `<div class="mult">
        <div class="mult-head"><b>${esc(name)}</b><span class="muted">${cs.length ? `${cs.length} count${cs.length === 1 ? "" : "s"} · net ${Cash.money(net, { sign: true })}` : "no counts"}</span></div>
        ${trendSVG(cs, start, end, maxAbs, flags)}
      </div>`;
    }).join("");
    wireTips(host);
  },

  renderCalendar() {
    const flags = Store.settings.flags;
    const m = this.calMonth;
    $("#calTitle").textContent = m.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const byDay = {};
    for (const c of Store.counts) {
      if ((this.f.drawer && c.drawerId !== this.f.drawer) || (this.f.person && c.cashier !== this.f.person)) continue;
      (byDay[c.date] = byDay[c.date] || []).push(c);
    }
    const rank = { good: 0, warn: 1, bad: 2 };
    let html = `<div class="cal">` + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < first.getDay(); i++) html += `<div class="cal-cell blank"></div>`;
    for (let day = 1; day <= daysIn; day++) {
      const iso = todayISO(new Date(m.getFullYear(), m.getMonth(), day));
      const cs = byDay[iso] || [];
      if (!cs.length) { html += `<div class="cal-cell ${iso === todayISO() ? "today" : ""}"><span class="cal-d">${day}</span></div>`; continue; }
      const worst = cs.reduce((w, c) => { const l = Cash.flagLevel(c.overShortCents, flags); return rank[l] > rank[w] ? l : w; }, "good");
      const net = cs.reduce((t, c) => t + c.overShortCents, 0);
      const tip = `${fmtDate(iso, { weekday: "long", month: "short", day: "numeric" })} — ${cs.length} count${cs.length === 1 ? "" : "s"}, net ${Cash.money(net, { sign: true })}`;
      html += `<button class="cal-cell has ${worst} ${this.f.day === iso ? "sel" : ""} ${iso === todayISO() ? "today" : ""}" data-day="${iso}" data-tip="${esc(tip)}">
        <span class="cal-d">${day}</span><span class="cal-ico">${flagIcon(worst)}</span><span class="cal-net">${Cash.money(net, { sign: true })}</span></button>`;
    }
    html += `</div>`;
    const host = $("#hCal");
    host.innerHTML = html;
    $$(".cal-cell.has", host).forEach((b) => (b.onclick = () => {
      this.f.day = this.f.day === b.dataset.day ? "" : b.dataset.day;
      if (this.f.day && !this.inRange({ date: this.f.day })) this.f.range = "all";
      this.render();
      if (this.f.day) $("#hListCard").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    wireTips(host);
  },

  renderPeople() {
    const flags = Store.settings.flags;
    const list = this.filtered();
    const by = {};
    for (const c of list) {
      const k = c.cashier || "(no name)";
      (by[k] = by[k] || []).push(c);
    }
    const rows = Object.entries(by).map(([name, cs]) => {
      const net = cs.reduce((t, c) => t + c.overShortCents, 0);
      const avgAbs = cs.reduce((t, c) => t + Math.abs(c.overShortCents), 0) / cs.length;
      const flagged = cs.filter((c) => Cash.flagLevel(c.overShortCents, flags) !== "good").length;
      return { name, n: cs.length, net, avgAbs, flagged, cs };
    }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const host = $("#hPeople");
    if (!rows.length) { host.innerHTML = `<div class="muted small-note">No counts in this range.</div>`; return; }
    const maxAvg = Math.max(flags.yellow, ...rows.map((r) => r.avgAbs));
    host.innerHTML = `<table class="tbl people-tbl">
      <thead><tr><th>Cashier</th><th class="r">Counts</th><th class="r">Net</th><th>Average miss</th><th class="r">Flagged</th></tr></thead>
      <tbody>${rows.map((r) => {
        const lvl = Cash.flagLevel(Math.round(r.avgAbs), flags);
        return `<tr>
          <td><b>${esc(r.name)}</b></td><td class="r num">${r.n}</td>
          <td class="r num">${Cash.money(r.net, { sign: true })}</td>
          <td><span class="avgbar" data-tip="${esc(`${r.name}: average ${Cash.money(Math.round(r.avgAbs))} off per count`)}"><span class="ab-fill ${lvl}" style="width:${Math.max(2, (r.avgAbs / maxAvg) * 100)}%"></span></span><span class="num ab-num">${Cash.money(Math.round(r.avgAbs))}</span></td>
          <td class="r">${r.flagged ? `<span class="os-badge warn tiny">${icon("alert")}<span>${r.flagged}</span></span>` : `<span class="os-badge good tiny">${icon("check")}<span>0</span></span>`}</td>
        </tr>`;
      }).join("")}</tbody></table>`;
    wireTips(host);
  },

  renderList() {
    const flags = Store.settings.flags;
    const list = this.filtered({ day: true, includeCounter: false }).slice().reverse();
    $("#hDayChip").innerHTML = this.f.day ? `<button class="chip" id="hDayClear">${esc(fmtDate(this.f.day, { weekday: "short", month: "short", day: "numeric" }))} ${icon("x")}</button>` : `<span class="f-help">${list.length} in range</span>`;
    const dc = $("#hDayClear");
    if (dc) dc.onclick = () => { this.f.day = ""; this.render(); };
    const host = $("#hList");
    if (!list.length) { host.innerHTML = `<div class="muted small-note">Nothing to show for these filters.</div>`; return; }
    const shown = list.slice(0, 300);
    host.innerHTML = `<div class="tbl-scroll"><table class="tbl counts-tbl">
      <thead><tr><th>Date</th><th>Drawer</th><th>Cashier</th><th>Counted by</th><th class="r">Pulled</th><th class="r">Register</th><th>Over / short</th><th></th></tr></thead>
      <tbody>${shown.map((c) => `
        <tr data-id="${esc(c.id)}">
          <td><b>${esc(fmtDate(c.date, { month: "short", day: "numeric" }))}</b> <span class="muted">${esc(fmtTime(c.ts))}</span></td>
          <td>${esc(c.drawerName)}</td><td>${esc(c.cashier || "—")}</td><td>${esc(c.counter || "—")}</td>
          <td class="r num">${Cash.money(c.pullCents)}</td><td class="r num">${Cash.money(c.expectedCents)}</td>
          <td>${osBadge(c.overShortCents, flags)}${c.note ? ` <span class="note-dot" data-tip="${esc(c.note)}">${icon("info")}</span>` : ""}</td>
          <td class="row-acts">
            <button class="icon-btn-sm" data-act="view" title="Details">${icon("info")}</button>
            <button class="icon-btn-sm" data-act="edit" title="Fix this count">${icon("edit")}</button>
            <button class="icon-btn-sm danger" data-act="del" title="Delete">${icon("trash")}</button>
          </td>
        </tr>`).join("")}</tbody></table></div>
      ${list.length > shown.length ? `<p class="f-help">Showing the latest ${shown.length} of ${list.length}. Narrow the filters or export a CSV for the rest.</p>` : ""}`;
    wireTips(host);
    $$("tr[data-id]", host).forEach((tr) => {
      const id = tr.dataset.id;
      tr.querySelector('[data-act="view"]').onclick = () => showCountDetail(id);
      tr.querySelector('[data-act="edit"]').onclick = () => CountView.edit(id);
      tr.querySelector('[data-act="del"]').onclick = () => deleteCount(id);
    });
  },

  renderBox() {
    const host = $("#hBox");
    const logs = Store.boxLogs.slice().sort((a, b) => b.ts - a.ts);
    if (!logs.length) { host.innerHTML = `<div class="muted small-note">No change box counts saved yet.</div>`; return; }
    host.innerHTML = `<div class="tbl-scroll"><table class="tbl">
      <thead><tr><th>Date</th><th>Counted by</th><th class="r">Box total</th><th>vs. ideal</th><th>Ordered</th><th class="r">Order</th><th class="r">To bank</th><th></th></tr></thead>
      <tbody>${logs.slice(0, 200).map((l) => `
        <tr data-id="${esc(l.id)}">
          <td><b>${esc(fmtDate(l.date, { month: "short", day: "numeric", year: "numeric" }))}</b></td>
          <td>${esc(l.counter || "—")}</td>
          <td class="r num">${Cash.dollars(l.boxTotal)}</td>
          <td>${l.variance === 0 ? `<span class="os-badge good tiny">${icon("check")}<span>Even</span></span>` : `<span class="os-badge ${Math.abs(l.variance) >= 20 ? "bad" : "warn"} tiny">${icon("alert")}<span>${l.variance > 0 ? "Over" : "Short"} ${Cash.dollars(Math.abs(l.variance))}</span></span>`}</td>
          <td class="small">${Cash.BOX_STOCK.filter((s) => l.order[s.id] > 0).map((s) => `${esc(s.label)} ${esc(Cash.packText(s.id, l.order[s.id]))}`).join(" · ") || '<span class="muted">nothing</span>'}</td>
          <td class="r num">${Cash.dollars(l.orderValue)}</td><td class="r num">${Cash.dollars(l.takeValue)}</td>
          <td class="row-acts"><button class="icon-btn-sm danger" data-act="del" title="Delete">${icon("trash")}</button></td>
        </tr>`).join("")}</tbody></table></div>`;
    $$("tr[data-id]", host).forEach((tr) => {
      tr.querySelector('[data-act="del"]').onclick = async () => {
        const i = Store.boxLogs.findIndex((l) => l.id === tr.dataset.id);
        if (i < 0) return;
        const ok = await confirmBox("Delete this change box record?", "It also stops counting toward the smart layout.", { okText: "Delete", danger: true });
        if (!ok) return;
        const [gone] = Store.boxLogs.splice(i, 1);
        await Store.save();
        App.refreshAll();
        showToast("Change box record deleted.", { undo: async () => { Store.boxLogs.push(gone); await Store.save(); App.refreshAll(); } });
      };
    });
  },
};

/* ---- the per-drawer diverging column chart ----
   Zero baseline; over grows up, short grows down. Each count is a column
   at its date (counts on the same day share the day's slot). Columns have
   a 4px rounded data end and a square baseline end. */
function trendSVG(cs, startISO, endISO, maxAbs, flags) {
  const W = 340, H = 118, padL = 40, padR = 6, padT = 8, padB = 18;
  const iw = W - padL - padR, ih = H - padT - padB;
  const s = parseISODate(startISO), e = parseISODate(endISO);
  const nDays = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const slot = iw / nDays;
  const M = niceCeil(maxAbs);
  const y = (v) => padT + ih / 2 - (v / M) * (ih / 2);
  const y0 = y(0);
  let g = "";
  // gridlines + ticks (hairline, recessive)
  for (const v of [M, 0, -M]) {
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "axis0" : "grid"}"/>`;
    g += `<text x="${padL - 5}" y="${y(v) + 3.5}" class="tick" text-anchor="end">${v === 0 ? "$0" : (v > 0 ? "+" : "−") + Cash.money(Math.abs(v), { noCents: true })}</text>`;
  }
  // green zone band
  const gz = Math.min(flags.green, M);
  if (gz > 0) g += `<rect x="${padL}" y="${y(gz)}" width="${iw}" height="${y(-gz) - y(gz)}" class="zone"/>`;
  // date labels: first & last
  g += `<text x="${padL}" y="${H - 4}" class="tick">${esc(fmtDate(startISO, { month: "short", day: "numeric" }))}</text>`;
  g += `<text x="${W - padR}" y="${H - 4}" class="tick" text-anchor="end">${esc(fmtDate(endISO, { month: "short", day: "numeric" }))}</text>`;
  const byDay = {};
  for (const c of cs) (byDay[c.date] = byDay[c.date] || []).push(c);
  for (const [iso, list] of Object.entries(byDay)) {
    const di = Math.round((parseISODate(iso) - s) / 86400000);
    if (di < 0 || di >= nDays) continue;
    const sub = slot / list.length;
    list.forEach((c, k) => {
      const bw = Math.max(2, Math.min(14, sub - 2));
      const x = padL + di * slot + k * sub + (sub - bw) / 2;
      const v = Math.max(-M, Math.min(M, c.overShortCents));
      const lvl = Cash.flagLevel(c.overShortCents, flags);
      const tip = `${fmtDate(c.date, { weekday: "short", month: "short", day: "numeric" })} ${fmtTime(c.ts)} · ${overShortWord(c.overShortCents)}${c.overShortCents ? " " + Cash.money(Math.abs(c.overShortCents)) : ""}${c.cashier ? " · " + c.cashier : ""}`;
      if (v === 0) {
        g += `<circle cx="${x + bw / 2}" cy="${y0}" r="3" class="mark good" data-tip="${esc(tip)}"/>`;
      } else {
        g += `<path d="${colPath(x, y0, bw, y(v))}" class="mark ${lvl}" data-tip="${esc(tip)}"/>`;
      }
      // generous invisible hit target
      g += `<rect x="${padL + di * slot + k * sub}" y="${padT}" width="${Math.max(sub, 4)}" height="${ih}" class="hit" data-tip="${esc(tip)}"/>`;
    });
  }
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Over and short per count">${g}</svg>`;
}

/* Column from baseline y0 to y1 with a rounded end at y1 (r ≤ 4). */
function colPath(x, y0, w, y1) {
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (y1 < y0) { // up
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

function niceCeil(cents) {
  const steps = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000];
  for (const s of steps) if (cents <= s) return s;
  return Math.ceil(cents / 100000) * 100000;
}

/* Hover tooltips for anything with data-tip inside host. */
function wireTips(host) {
  const tip = $("#tip");
  $$("[data-tip]", host).forEach((n) => {
    n.addEventListener("mouseenter", () => { tip.textContent = n.getAttribute("data-tip"); tip.classList.add("show"); });
    n.addEventListener("mousemove", (e) => {
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14, yy = e.clientY + 14;
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
      if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
      tip.style.left = x + "px"; tip.style.top = yy + "px";
    });
    n.addEventListener("mouseleave", () => tip.classList.remove("show"));
  });
}

function showCountDetail(id) {
  const c = Store.counts.find((x) => x.id === id);
  if (!c) return;
  const flags = Store.settings.flags;
  const row = (obj, d) => obj[d.id] ? `<tr><td>${moneyPic(d.id, "sm")} ${d.label}</td><td class="r num">${obj[d.id]}</td><td class="r num">${Cash.money(obj[d.id] * d.cents)}</td></tr>` : "";
  const back = el("div", "modal-back show");
  back.innerHTML = `<div class="modal">
    <div class="modal-head"><h2>${esc(c.drawerName)} — ${esc(fmtDate(c.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h2><button class="modal-close" title="Close">${icon("x")}</button></div>
    <div class="modal-body">
      <div class="detail-top">
        ${osBadge(c.overShortCents, flags, { big: true })}
        <div class="muted">Saved ${esc(fmtDateTime(c.ts))}${c.editedAt ? ` · edited ${esc(fmtDateTime(c.editedAt))}` : ""}<br>Cashier <b>${esc(c.cashier || "—")}</b> · Counted by <b>${esc(c.counter || "—")}</b></div>
      </div>
      <div class="detail-nums">
        <div><span>Counted</span><b>${Cash.money(c.totalCents)}</b></div>
        <div><span>Left in drawer</span><b>${Cash.money(c.leaveCents)}</b></div>
        <div><span>Pulled</span><b>${Cash.money(c.pullCents)}</b></div>
        <div><span>Register said</span><b>${Cash.money(c.expectedCents)}</b></div>
      </div>
      ${c.note ? `<div class="notice info slim">${icon("info")}<div>${esc(c.note)}</div></div>` : ""}
      <div class="detail-cols">
        <div><h4>Counted</h4><table class="tbl compact">${Cash.DRAWER_DENOMS.map((d) => row(c.counts, d)).join("")}</table></div>
        <div><h4>Pulled</h4><table class="tbl compact">${Cash.DRAWER_DENOMS.map((d) => row(c.pull, d)).join("") || '<tr><td class="muted">Nothing</td></tr>'}</table></div>
      </div>
    </div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  $(".modal-close", back).onclick = close;
}

async function deleteCount(id) {
  const i = Store.counts.findIndex((c) => c.id === id);
  if (i < 0) return;
  const c = Store.counts[i];
  const ok = await confirmBox("Delete this count?", `${esc(c.drawerName)} on ${esc(fmtDate(c.date, { month: "long", day: "numeric" }))} (${overShortWord(c.overShortCents)}${c.overShortCents ? " " + Cash.money(Math.abs(c.overShortCents)) : ""}).`, { okText: "Delete", danger: true });
  if (!ok) return;
  const [gone] = Store.counts.splice(i, 1);
  await Store.save();
  App.refreshAll();
  showToast("Count deleted.", { undo: async () => { Store.counts.push(gone); await Store.save(); App.refreshAll(); } });
}

function exportCSV() {
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const denoms = Cash.DRAWER_DENOMS.map((d) => d.id);
  const head = ["date", "time", "drawer", "cashier", "counted_by", "counted", "left", "pulled", "register_said", "over_short", "flag", "note", ...denoms.map((d) => "count_" + d)];
  const rows = Store.counts.slice().sort((a, b) => a.ts - b.ts).map((c) => [
    c.date, fmtTime(c.ts), c.drawerName, c.cashier, c.counter,
    (c.totalCents / 100).toFixed(2), (c.leaveCents / 100).toFixed(2), (c.pullCents / 100).toFixed(2), (c.expectedCents / 100).toFixed(2), (c.overShortCents / 100).toFixed(2),
    Cash.flagLevel(c.overShortCents, Store.settings.flags), c.note,
    ...denoms.map((d) => c.counts[d] || 0),
  ].map(q).join(","));
  downloadText(`ace-drawer-counts-${todayISO()}.csv`, [head.join(","), ...rows].join("\r\n"), "text/csv");
}
