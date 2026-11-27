/* SKU lookup client: debounced auto-lookup with stale-response guard,
   sale auto-detection, and a diagnostics trail (viewable in a modal). */
"use strict";

let lastDiagnostics = [];

/* While any SKU lookup runs, <body> carries .sku-busy (a thin red bar
   sweeps along the top of the preview). Counted, so several Multi Product
   cards looking up at once keep it on until the last one lands. */
let _lookupsBusy = 0;
function lookupBusy(d) {
  _lookupsBusy = Math.max(0, _lookupsBusy + d);
  document.body.classList.toggle("sku-busy", _lookupsBusy > 0);
}

async function lookupProductAPI(query, refresh) {
  const url = `/api/lookup?q=${encodeURIComponent(query)}${refresh ? "&refresh=1" : ""}&store=${encodeURIComponent(Settings.get().storeCode || "12180")}`;
  const resp = await fetch(url);
  const data = await resp.json();
  lastDiagnostics = data.diagnostics || [];
  return data;
}

/* Is the product on sale? Guard against sale == regular price quirks. */
function saleInfo(p) {
  const price = parseFloat(p.price || p.listPrice || "");
  const sale = parseFloat(p.salePrice || "");
  if (!isNaN(sale) && !isNaN(price) && sale < price) {
    return { onSale: true, sale: sale.toFixed(2), reg: price.toFixed(2) };
  }
  return { onSale: false };
}

/* Wire an input for lookup: 600ms debounce + Enter + blur.
   Enter and blur cancel the debounce the last keystroke armed, and a query
   already in flight is not re-issued — typing a SKU and hitting Enter used
   to fire two full lookups for the same thing, and the second one is what
   the user waited on. */
function attachAutoLookup(inputEl, statusEl, onResult) {
  let debTimer = null;
  let inFlight = null; // query currently being looked up
  let lastDone = null; // query whose lookup last succeeded
  // Stale-response guard, per input: a newer lookup in this same box makes
  // an older answer stale, but a lookup in another box (a second Multi
  // Product card) does not, so each card's answer still lands and its
  // spinner always ends.
  let seq = 0;
  // The lookup's state lives on the input too (data-lookup = pending /
  // busy / ok / err) so the SKU box itself can show it: an armed underline
  // while typing, a spinner while looking up, a check when it lands.
  const setState = (st) => {
    if (st) inputEl.dataset.lookup = st; else delete inputEl.dataset.lookup;
  };
  const run = async (force) => {
    clearTimeout(debTimer);
    debTimer = null;
    const q = inputEl.value.trim();
    if (!q) { statusEl.className = "lookup-status"; statusEl.textContent = ""; setState(""); return; }
    if (inFlight === q && force !== true) return; // same query already running
    inFlight = q;
    const mine = ++seq;
    setState("busy");
    lookupBusy(1);
    statusEl.className = "lookup-status busy";
    // the SKU box shows the spinner and the preview shows the bar, so the
    // line under the box only says what is being looked up
    statusEl.textContent = `Looking up ${q}…`;
    try {
      const res = await lookupProductAPI(q, force === true);
      // Stale by sequence, or stale by editor rebuild: clicking a queued row
      // blurs this input (starting a lookup for the *old* product) and then
      // rebuilds the editor — if this input is no longer in the document,
      // onResult would write the old product onto whatever spec is now open.
      // A newer lookup in this box owns its busy state and status line.
      if (mine !== seq || !inputEl.isConnected) return;
      if (res.ok) {
        lastDone = q;
        const si = saleInfo(res);
        setState("ok");
        statusEl.className = "lookup-status ok";
        statusEl.innerHTML = `<span class="lk-ico">✓</span> ${esc(res.name || res.sku)}` +
          (si.onSale ? ` <span class="sale-flag">On Sale</span>` : "") +
          ` <button type="button" class="diag-link" onclick="showDiagnostics()">details</button>`;
        onResult(res, si);
      } else {
        setState("err");
        statusEl.className = "lookup-status err";
        statusEl.innerHTML = `<span class="lk-ico">✗</span> ${esc(res.error || "Lookup failed")} <button type="button" class="diag-link" onclick="showDiagnostics()">details</button>`;
      }
    } catch (e) {
      if (mine !== seq || !inputEl.isConnected) return;
      setState("err");
      statusEl.className = "lookup-status err";
      statusEl.innerHTML = `<span class="lk-ico">✗</span> ${esc(e.message || "No connection")} — enter details manually`;
    } finally {
      if (inFlight === q) inFlight = null;
      lookupBusy(-1);
    }
  };
  inputEl.addEventListener("input", () => {
    clearTimeout(debTimer);
    setState(inputEl.value.trim() ? "pending" : "");
    debTimer = setTimeout(run, 600);
  });
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  // Blur covers a pasted SKU that never got Enter — but it must not repeat
  // a lookup that already answered for this same value: the repeat lands a
  // moment later and puts the looked-up name/price back over whatever the
  // user edited right after leaving the field (a price typed next, a name
  // changed on the preview). Enter still re-runs on purpose.
  inputEl.addEventListener("blur", () => {
    const q = inputEl.value.trim();
    if (q && q !== lastDone) run();
  });
  return run;
}

function showDiagnostics() {
  $("#diagBody").textContent = lastDiagnostics.length ? lastDiagnostics.map((d, i) => `${i + 1}. ${d}`).join("\n") : "No lookup has run yet.";
  $("#diagModal").classList.add("show");
}
