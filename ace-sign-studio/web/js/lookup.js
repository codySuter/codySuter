/* SKU lookup client: debounced auto-lookup with stale-response guard,
   sale auto-detection, and a diagnostics trail (viewable in a modal). */
"use strict";

let _lookupSeq = 0;
let lastDiagnostics = [];

async function lookupProductAPI(query, refresh) {
  const seq = ++_lookupSeq;
  const url = `/api/lookup?q=${encodeURIComponent(query)}${refresh ? "&refresh=1" : ""}&store=${encodeURIComponent(Settings.get().storeCode || "12180")}`;
  const resp = await fetch(url);
  const data = await resp.json();
  data._stale = seq !== _lookupSeq;
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
  const run = async (force) => {
    clearTimeout(debTimer);
    debTimer = null;
    const q = inputEl.value.trim();
    if (!q) { statusEl.className = "lookup-status"; statusEl.textContent = ""; return; }
    if (inFlight === q && force !== true) return; // same query already running
    inFlight = q;
    statusEl.className = "lookup-status busy";
    statusEl.innerHTML = `<span class="spin"></span> Looking up ${esc(q)}…`;
    try {
      const res = await lookupProductAPI(q, force === true);
      // Stale by sequence, or stale by editor rebuild: clicking a queued row
      // blurs this input (starting a lookup for the *old* product) and then
      // rebuilds the editor — if this input is no longer in the document,
      // onResult would write the old product onto whatever spec is now open.
      if (res._stale || !inputEl.isConnected) return;
      if (res.ok) {
        const si = saleInfo(res);
        statusEl.className = "lookup-status ok";
        statusEl.innerHTML = `✓ ${esc(res.name || res.sku)}` +
          (si.onSale ? ` <span class="sale-flag">On Sale</span>` : "") +
          ` <span class="diag-link" onclick="showDiagnostics()">details</span>`;
        onResult(res, si);
      } else {
        statusEl.className = "lookup-status err";
        statusEl.innerHTML = `✗ ${esc(res.error || "Lookup failed")} <span class="diag-link" onclick="showDiagnostics()">details</span>`;
      }
    } catch (e) {
      statusEl.className = "lookup-status err";
      statusEl.textContent = `✗ ${e.message || "No connection"} — enter details manually`;
    } finally {
      if (inFlight === q) inFlight = null;
    }
  };
  inputEl.addEventListener("input", () => {
    clearTimeout(debTimer);
    debTimer = setTimeout(run, 600);
  });
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  inputEl.addEventListener("blur", () => { if (inputEl.value.trim()) run(); });
  return run;
}

function showDiagnostics() {
  $("#diagBody").textContent = lastDiagnostics.length ? lastDiagnostics.map((d, i) => `${i + 1}. ${d}`).join("\n") : "No lookup has run yet.";
  $("#diagModal").classList.add("show");
}
