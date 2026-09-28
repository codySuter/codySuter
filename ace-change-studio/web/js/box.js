/* ============================================================
   Ace Change Studio — Change Box view.

   Count the box → what to call in (whole rolls; bills in straps / half
   straps where the swap allows) and which bills to take to the bank,
   always an even swap. Saved counts feed the smart-layout suggestion.
   ============================================================ */
"use strict";

const BOX_DRAFT_KEY = "acs.boxDraft";

const BoxView = {
  s: null,

  blank(keep) {
    return { rolls: {}, straps: {}, loose: {}, big: {}, counter: keep ? keep.counter : "", date: todayISO() };
  },

  init() {
    this.s = this.loadDraft() || this.blank();
    const v = $("#view-box");
    v.innerHTML = `
      <div class="view-head">
        <div>
          <h2>Change box order</h2>
          <p>Count what's in the change box. You'll get what to call in and which bills to take to the bank — always an even swap.</p>
        </div>
      </div>
      <div class="count-layout">
        <div class="card count-card">
          <div class="who-row">
            <label class="who"><span>${icon("check")} Counted by</span><select class="f-input" id="bCounter"></select></label>
            <label class="who narrow"><span>${icon("cal")} Date</span><input type="date" class="f-input" id="bDate"></label>
          </div>
          <div id="bRows"></div>
          <div class="card-foot">
            <span class="f-help" id="bTotals"></span>
            <button class="btn btn-ghost" id="bClear">${icon("refresh")} Start over</button>
          </div>
        </div>
        <aside class="card result-card" id="bResult"></aside>
      </div>
      <div class="card smart-card" id="smartCard"></div>`;
    $("#bDate").value = this.s.date;
    $("#bDate").onchange = () => { this.s.date = $("#bDate").value || todayISO(); this.saveDraft(); };
    $("#bCounter").onchange = async (e) => {
      if (e.target.value === "__add") { const n = await addPersonFlow(); this.fillPeople(); e.target.value = n || ""; }
      this.s.counter = $("#bCounter").value;
      this.saveDraft();
    };
    $("#bClear").onclick = () => {
      if (!this.hasAny()) return this.clear();
      confirmBox("Start over?", "This clears what you've typed for the change box.", { okText: "Clear it", danger: true }).then((ok) => ok && this.clear());
    };
    this.renderRows();
    this.refresh();
  },

  refresh() {
    if (!this.s) return;
    this.fillPeople();
    this.renderGauges();
    this.renderResult();
    this.renderSmart();
  },

  fillPeople() {
    const sel = $("#bCounter");
    const cur = this.s.counter;
    const names = Store.settings.people.slice();
    if (cur && !names.includes(cur)) names.push(cur);
    sel.innerHTML = `<option value="">Who's counting?</option>` + names.map((p) => `<option ${p === cur ? "selected" : ""}>${esc(p)}</option>`).join("") + `<option value="__add">＋ Add a name…</option>`;
  },

  have() {
    const h = {};
    for (const id of ["rq", "rd", "rn"]) h[id] = parseInt(this.s.rolls[id], 10) || 0;
    for (const id of ["b1", "b5", "b10"]) h[id] = (parseInt(this.s.straps[id], 10) || 0) * 100 + (parseInt(this.s.loose[id], 10) || 0);
    for (const id of ["b20", "b50", "b100"]) h[id] = parseInt(this.s.big[id], 10) || 0;
    return h;
  },
  hasAny() { return Object.values(this.have()).some((n) => n > 0); },

  renderRows() {
    const host = $("#bRows");
    const rollRow = (id) => {
      const st = Cash.BOX_STOCK.find((x) => x.id === id);
      return `<div class="c-row box-row" data-id="${id}">
        <span class="c-pic">${moneyPic(id)}</span>
        <span class="c-label"><b>${st.label}</b><small>${Cash.dollars(st.dollars)} rolls · never opened</small></span>
        <span class="stepper">
          <button class="step" data-k="rolls" data-step="-1" tabindex="-1">${icon("minus")}</button>
          <span class="cnt-wrap"><input class="cnt" data-k="rolls" value="${esc(this.s.rolls[id] || "")}" placeholder="0" aria-label="${st.label} rolls"></span>
          <button class="step" data-k="rolls" data-step="1" tabindex="-1">${icon("plus")}</button>
        </span>
        <span class="unit-label">rolls</span>
        <span class="gauge-wrap" id="g-${id}"></span>
      </div>`;
    };
    const billRow = (id) => {
      const st = Cash.BOX_STOCK.find((x) => x.id === id);
      return `<div class="c-row box-row bill-box-row" data-id="${id}">
        <span class="c-pic">${moneyPic(id)}</span>
        <span class="c-label"><b>${st.label}</b><small>Straps of 100 · loose bills OK</small></span>
        <span class="strap-inputs">
          <span class="cnt-wrap"><input class="cnt" data-k="straps" value="${esc(this.s.straps[id] || "")}" placeholder="0" aria-label="${st.label} full straps"></span><span class="unit-label">straps +</span>
          <span class="cnt-wrap"><input class="cnt" data-k="loose" value="${esc(this.s.loose[id] || "")}" placeholder="0" aria-label="${st.label} loose bills"></span><span class="unit-label">loose</span>
        </span>
        <span class="gauge-wrap" id="g-${id}"></span>
      </div>`;
    };
    const bigRow = (id) => {
      const b = Cash.BOX_BIG.find((x) => x.id === id);
      return `<div class="c-row box-row" data-id="${id}">
        <span class="c-pic">${moneyPic(id)}</span>
        <span class="c-label"><b>${b.label}</b><small>go to the bank</small></span>
        <span class="stepper">
          <button class="step" data-k="big" data-step="-1" tabindex="-1">${icon("minus")}</button>
          <span class="cnt-wrap"><input class="cnt" data-k="big" value="${esc(this.s.big[id] || "")}" placeholder="0" aria-label="${b.label}"></span>
          <button class="step" data-k="big" data-step="1" tabindex="-1">${icon("plus")}</button>
        </span>
        <span class="unit-label">bills</span>
        <span class="gauge-wrap big-val" id="g-${id}"></span>
      </div>`;
    };
    host.innerHTML = `
      <div class="count-section"><h3>Coin rolls</h3>${["rq", "rd", "rn"].map(rollRow).join("")}</div>
      <div class="count-section"><h3>Bills</h3>${["b1", "b5", "b10"].map(billRow).join("")}</div>
      <div class="count-section"><h3>Big bills in the box</h3>${["b20", "b50", "b100"].map(bigRow).join("")}</div>
      <div class="gauge-key"><span><i class="gk-have"></i>In the box now</span><span><i class="gk-order"></i>Coming in the order</span><span><i class="gk-ideal"></i>Ideal</span></div>`;
    $$(".box-row", host).forEach((row) => {
      const id = row.dataset.id;
      $$("input.cnt", row).forEach((inp) => wireNumberInput(inp, () => {
        this.s[inp.dataset.k][id] = inp.value;
        this.changed();
      }));
      $$(".step", row).forEach((b) => (b.onclick = () => {
        const k = b.dataset.k;
        const n = Math.max(0, (parseInt(this.s[k][id], 10) || 0) + Number(b.dataset.step));
        this.s[k][id] = n ? String(n) : "";
        $(`input.cnt[data-k="${k}"]`, row).value = this.s[k][id];
        this.changed();
      }));
    });
  },

  changed() {
    this.saveDraft();
    this.renderGauges();
    this.renderResult();
  },

  plan() {
    const st = Store.settings;
    return Cash.planOrder(this.have(), st.ideal, { billRound: st.billRound, excessThreshold: st.excessThreshold });
  },

  renderGauges() {
    const p = this.plan();
    for (const s of Cash.BOX_STOCK) {
      const g = $("#g-" + s.id);
      if (!g) continue;
      const ideal = p.ideal[s.id] || 0;
      const have = p.have[s.id];
      const incoming = p.order[s.id];
      const scale = Math.max(ideal * 1.25, have + incoming, 1);
      const pct = (n) => Math.min(100, (n / scale) * 100);
      const unit = s.unit === "roll" ? "rolls" : "bills";
      g.innerHTML = `
        <span class="gauge" title="${have} of ${ideal} ${unit}${incoming ? ` · +${incoming} coming` : ""}">
          <span class="g-have" style="width:${pct(have)}%"></span><span class="g-order" style="width:${pct(incoming)}%"></span>
          <span class="g-ideal" style="left:${pct(ideal)}%"></span>
        </span>
        <span class="g-text"><b>${have}</b> of ${ideal}</span>`;
    }
    for (const b of Cash.BOX_BIG) {
      const g = $("#g-" + b.id);
      const n = p.have[b.id];
      if (g) g.innerHTML = n ? `<span class="g-text">${Cash.dollars(n * b.dollars)}</span>` : "";
    }
    $("#bTotals").innerHTML = `Box total <b>${Cash.dollars(p.boxTotal)}</b> · ideal ${Cash.dollars(p.idealTotal)}`;
  },

  renderResult() {
    const host = $("#bResult");
    const p = this.plan();
    const any = this.hasAny();
    if (!any) {
      host.innerHTML = `
        <div class="res-head"><div class="hero-label">Change order</div><div class="hero muted">—</div></div>
        <div class="empty-state">${icon("box", "big-ico")}<p>Count the change box on the left. The order and the bank bills show up here as you type.</p>
        <p class="muted">Ideal box: ${Cash.dollars(Cash.sumDollars(Store.settings.ideal))} — change it in Settings.</p></div>`;
      return;
    }
    const v = p.variance;
    const varianceHTML = v === 0
      ? `<div class="notice good">${icon("check")}<div><b>The box adds up to its ideal ${Cash.dollars(p.idealTotal)}.</b></div></div>`
      : `<div class="notice ${Math.abs(v) >= 20 ? "bad" : "warn"}">${icon("alert")}<div><b>The box is ${Cash.dollars(Math.abs(v))} ${v > 0 ? "over" : "short"}</b> of its ideal ${Cash.dollars(p.idealTotal)}. ${v > 0 ? "Probably extra from a drawer — double-check the last few swaps." : "Recount the box, and check recent drawer swaps for a mix-up."}</div></div>`;
    const orderRows = Cash.BOX_STOCK.filter((s) => p.order[s.id] > 0).map((s) => `
      <div class="ord-row">${moneyPic(s.id, "sm")}<span class="or-l">${s.label}</span><span class="or-pack">${Cash.packText(s.id, p.order[s.id])}</span><span class="or-v">${Cash.dollars(p.order[s.id] * s.dollars)}</span></div>`).join("");
    const takeRows = ["b100", "b50", "b20", "b10", "b5"].filter((id) => p.take[id] > 0).map((id) => `
      <div class="ord-row">${moneyPic(id, "sm")}<span class="or-l">$${Cash.BOX_VALUE[id]} bills</span><span class="or-pack">${p.take[id]} bill${p.take[id] === 1 ? "" : "s"}</span><span class="or-v">${Cash.dollars(p.take[id] * Cash.BOX_VALUE[id])}</span></div>`).join("");
    const notes = p.notes.map((n) => `<div class="notice ${n.kind === "warn" ? "warn" : "info"} slim">${icon(n.kind === "warn" ? "alert" : "info")}<div>${esc(n.text)}</div></div>`).join("");

    host.innerHTML = `
      ${varianceHTML}
      ${p.nothingToOrder
        ? `<div class="empty-state slim">${icon("check", "big-ico good-ico")}<p><b>Nothing to order.</b> Every roll and bill is at or above its ideal.</p></div>`
        : `<div class="order-card">
            <div class="oc-head">${icon("phone")} Call in this order</div>
            ${orderRows}
            <div class="ord-total"><span>Order total</span><b>${Cash.dollars(p.orderValue)}</b></div>
          </div>
          <div class="order-card bank">
            <div class="oc-head">${icon("bank")} Take these bills to the bank</div>
            ${takeRows || `<div class="muted small-note">No bills to take.</div>`}
            <div class="ord-total"><span>Bills total</span><b>${Cash.dollars(p.takeValue)}</b></div>
          </div>
          <div class="even-check ${p.even ? "ok" : "off"}">${icon(p.even ? "check" : "alert")} ${p.even ? `Even swap — ${Cash.dollars(p.takeValue)} out, ${Cash.dollars(p.orderValue)} back` : `Not even: ${Cash.dollars(p.takeValue)} out vs ${Cash.dollars(p.orderValue)} back`}</div>`}
      ${notes}
      <div class="btn-row">
        ${p.nothingToOrder ? "" : `<button class="btn btn-secondary" id="bCopy">${icon("copy")} Copy</button><button class="btn btn-secondary" id="bPrint">${icon("printer")} Print sheet</button>`}
        <button class="btn btn-primary" id="bSave">${icon("save")} ${p.nothingToOrder ? "Save box count" : "Save order"}</button>
      </div>
      <p class="f-help center">Saving records this count and order in History, and helps the app learn how fast you use change.</p>`;

    const copy = $("#bCopy");
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(Cash.orderText(p, { title: `Change order — ${Store.settings.storeLine.split("·")[0].trim()} — ${fmtDate(this.s.date, { month: "short", day: "numeric", year: "numeric" })}` })); showToast(`${icon("check")} Order copied.`); }
      catch (e) { showToast("Couldn't copy — select the order and copy it by hand.", { kind: "error" }); }
    };
    const pr = $("#bPrint");
    if (pr) pr.onclick = () => printOrderSheet(p, this.s);
    $("#bSave").onclick = () => this.save(p);
  },

  async save(p) {
    if (!this.hasAny()) return;
    if (!this.s.counter) {
      const ok = await confirmBox("Save without a name?", "Nobody's picked as the counter. Save anyway?", { okText: "Save anyway", cancelText: "Go back" });
      if (!ok) return;
    }
    const log = {
      id: uid(), ts: Date.now(), date: this.s.date || todayISO(), counter: this.s.counter,
      have: p.have, order: p.order, take: p.take, after: p.after, ideal: p.ideal,
      orderValue: p.orderValue, takeValue: p.takeValue, boxTotal: p.boxTotal, idealTotal: p.idealTotal, variance: p.variance,
    };
    Store.boxLogs.push(log);
    const ok = await Store.save();
    if (!ok) { Store.boxLogs.pop(); showToast("Couldn't save — try again in a moment.", { kind: "error", ms: 8000 }); return; }
    showToast(`${icon("check")} ${p.nothingToOrder ? "Box count saved." : `Order saved — ${Cash.dollars(p.orderValue)}.`}`);
    this.clear();
    App.refreshAll();
  },

  clear() {
    this.s = this.blank(this.s);
    this.saveDraft();
    $("#bDate").value = this.s.date;
    this.renderRows();
    this.refresh();
  },

  renderSmart() {
    const host = $("#smartCard");
    const st = Store.settings;
    const sug = Cash.suggestIdeal(Store.boxLogs, st.ideal);
    const head = `<div class="smart-head">${icon("spark")}<div><h3>Smart box layout</h3><p>Learns how fast you go through each coin and bill, and suggests an ideal box where nothing runs out early.</p></div></div>`;
    if (!sug.ready) {
      const logPct = Math.min(100, (sug.logs / Cash.MIN_LOGS) * 100);
      const dayPct = Math.min(100, (sug.days / Cash.MIN_DAYS) * 100);
      host.innerHTML = `${head}
        <div class="learn">
          ${sug.noUsage ? `<p class="muted">No change has been used between the saved counts yet.</p>` : `<p>Still learning. Save each change-box count and the suggestion unlocks after <b>${Cash.MIN_LOGS} counts</b> over <b>${Cash.MIN_DAYS} days</b>.</p>`}
          <div class="learn-row"><span>Box counts saved</span><span class="meter"><span style="width:${logPct}%"></span></span><b>${Math.min(sug.logs, Cash.MIN_LOGS)} / ${Cash.MIN_LOGS}</b></div>
          <div class="learn-row"><span>Days of history</span><span class="meter"><span style="width:${dayPct}%"></span></span><b>${Math.min(Math.floor(sug.days), Cash.MIN_DAYS)} / ${Cash.MIN_DAYS}</b></div>
        </div>`;
      return;
    }
    const days = (x) => (Number.isFinite(x) ? `${Math.round(x)} day${Math.round(x) === 1 ? "" : "s"}` : "—");
    const units = (id, n) => (Cash.BOX_STOCK.find((s) => s.id === id).unit === "roll" ? `${n} rolls` : Cash.packText(id, n) + ` <small class="muted">(${n})</small>`);
    const rate = (r) => {
      const s = Cash.BOX_STOCK.find((x) => x.id === r.id);
      const perWeek = r.perDay * 7;
      return perWeek < 0.05 ? "barely used" : `${perWeek < 10 ? perWeek.toFixed(1) : Math.round(perWeek)} ${s.unit}s / week`;
    };
    host.innerHTML = `${head}
      ${sug.changed
        ? `<div class="smart-hero">With the suggested layout, the first thing to run out lasts <b>~${days(sug.minCoverNext)}</b> instead of <b>~${days(sug.minCoverNow)}</b> — about the same ${Cash.dollars(sug.total)} in the box.</div>`
        : `<div class="smart-hero">${icon("check")} Your ideal box already matches how you use change.</div>`}
      <table class="tbl smart-tbl">
        <thead><tr><th>Denomination</th><th>Used</th><th>Ideal now</th><th>Lasts</th><th>Suggested</th><th>Lasts</th></tr></thead>
        <tbody>${sug.rows.map((r) => `
          <tr class="${r.now !== r.next ? "chg" : ""}">
            <td>${moneyPic(r.id, "sm")} ${esc(r.label)}</td><td class="muted">${rate(r)}</td>
            <td>${units(r.id, r.now)}</td><td class="muted">${days(r.coverNow)}</td>
            <td><b>${units(r.id, r.next)}</b> ${r.next > r.now ? `<span class="chg-up">${icon("up")}</span>` : r.next < r.now ? `<span class="chg-down">${icon("down")}</span>` : ""}</td><td>${days(r.coverNext)}</td>
          </tr>`).join("")}</tbody>
      </table>
      <p class="f-help">Based on ${sug.logs} box counts over ${Math.round(sug.days)} days. Minimums: 2 rolls of each coin, a half strap of each bill.</p>
      ${sug.changed ? `<div class="btn-row"><button class="btn btn-primary" id="smartApply">${icon("spark")} Use this layout</button></div>` : ""}`;
    const apply = $("#smartApply");
    if (apply) apply.onclick = async () => {
      const ok = await confirmBox("Use the suggested layout?", `Your ideal change box becomes ${Cash.dollars(sug.total)}. Future orders will aim for the new amounts. You can change it back any time in Settings.`, { okText: "Use it" });
      if (!ok) return;
      const prev = Object.assign({}, st.ideal);
      st.ideal = Object.assign({}, sug.next);
      await Store.save();
      App.refreshAll();
      showToast(`${icon("check")} Ideal box updated.`, { undo: async () => { st.ideal = prev; await Store.save(); App.refreshAll(); } });
    };
  },

  saveDraft() { try { localStorage.setItem(BOX_DRAFT_KEY, JSON.stringify(this.s)); } catch (e) { /* ignore */ } },
  loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(BOX_DRAFT_KEY) || "null");
      if (!d || typeof d !== "object") return null;
      const s = Object.assign(this.blank(), d);
      s.date = todayISO();
      return s;
    } catch (e) { return null; }
  },
};

/* A printable, Ace-branded order sheet — letter size, 0.4in margins (the
   store's Brother printer loses ~0.25in on every edge). */
function printOrderSheet(p, s) {
  const st = Store.settings;
  const origin = location.origin;
  const rows = Cash.BOX_STOCK.filter((x) => p.order[x.id] > 0).map((x) => `<tr><td>${x.label}</td><td>${Cash.packText(x.id, p.order[x.id])}</td><td class="r">${p.order[x.id]} ${x.unit}${p.order[x.id] === 1 ? "" : "s"}</td><td class="r">${Cash.dollars(p.order[x.id] * x.dollars)}</td></tr>`).join("");
  const take = ["b100", "b50", "b20", "b10", "b5"].filter((id) => p.take[id] > 0).map((id) => `<tr><td>$${Cash.BOX_VALUE[id]} bills</td><td class="r">${p.take[id]}</td><td class="r">${Cash.dollars(p.take[id] * Cash.BOX_VALUE[id])}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Change order</title><style>
    @font-face{font-family:R;font-weight:400;src:url(${origin}/fonts/Roboto-Regular.ttf)}
    @font-face{font-family:R;font-weight:700;src:url(${origin}/fonts/Roboto-Bold.ttf)}
    @font-face{font-family:R;font-weight:900;src:url(${origin}/fonts/Roboto-Black.ttf)}
    @page{size:letter;margin:0.4in}
    body{font-family:R,Arial,sans-serif;color:#111;margin:0;font-size:12pt}
    .band{background:#D40029;color:#fff;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .band img{height:34px;background:#fff;border-radius:5px;padding:4px 7px}
    .band h1{font-weight:900;font-size:22pt;margin:0;letter-spacing:.3px}
    .meta{display:flex;justify-content:space-between;margin:12px 2px 18px;color:#444;font-size:11pt}
    h2{font-weight:900;font-size:14pt;margin:18px 0 6px;color:#9E0620;text-transform:uppercase;letter-spacing:.8px}
    table{width:100%;border-collapse:collapse}
    td,th{padding:9px 8px;border-bottom:1px solid #D0D2D3;text-align:left}
    th{font-size:9.5pt;text-transform:uppercase;letter-spacing:.8px;color:#6D6E71}
    .r{text-align:right}
    tr.tot td{font-weight:900;border-bottom:2px solid #111;font-size:13pt}
    .even{margin-top:16px;padding:10px 12px;border:2px solid #111;border-radius:6px;font-weight:700}
    .sign{display:flex;gap:28px;margin-top:40px}
    .sign div{flex:1;border-top:1px solid #111;padding-top:5px;font-size:10pt;color:#444}
  </style></head><body>
    <div class="band"><img src="${origin}/img/ace_logo_transparent.png" alt="Ace"><h1>Change Order</h1></div>
    <div class="meta"><span>${esc(st.storeLine)}</span><span>${esc(fmtDate(s.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}${s.counter ? " · Counted by " + esc(s.counter) : ""}</span></div>
    <h2>Call in</h2>
    <table><tr><th>Denomination</th><th>Packaging</th><th class="r">Quantity</th><th class="r">Amount</th></tr>${rows}
      <tr class="tot"><td colspan="3">Order total</td><td class="r">${Cash.dollars(p.orderValue)}</td></tr></table>
    <h2>Take to the bank</h2>
    <table><tr><th>Bills</th><th class="r">Count</th><th class="r">Amount</th></tr>${take}
      <tr class="tot"><td colspan="2">Bills total</td><td class="r">${Cash.dollars(p.takeValue)}</td></tr></table>
    <div class="even">${p.even ? "✓ Even swap" : "⚠ Not an even swap"} — ${Cash.dollars(p.takeValue)} in bills for ${Cash.dollars(p.orderValue)} in change. Box after the swap: ${Cash.dollars(p.afterTotal)} (ideal ${Cash.dollars(p.idealTotal)}).</div>
    <div class="sign"><div>Called in by</div><div>Picked up / verified by</div><div>Date</div></div>
  </body></html>`;
  const frame = $("#printFrame");
  frame.srcdoc = html;
  frame.onload = () => {
    const w = frame.contentWindow;
    w.document.fonts.ready.then(() => { w.focus(); w.print(); });
    frame.onload = null;
  };
}
