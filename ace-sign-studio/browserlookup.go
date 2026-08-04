package main

// Browser-driven lookup.
//
// acehardware.com is behind bot protection that serves a raw HTTP client a
// challenge/shell page (HTTP 200 with no product data) and refuses the
// storefront pricing API with 401. A real browser runs the challenge
// JavaScript, earns a legitimate session, and can then call the pricing API
// same-origin with the site's own authorization — which is how the original
// Mac app (a WKWebView) succeeded where a plain HTTP client cannot.
//
// We drive a headless instance of the user's own Edge/Chrome (the same
// browser the app already uses for its window) via the DevTools protocol:
// navigate to the product page, then evaluate an in-page fetch to the
// storefront API with the store's purchaseLocation.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

// awaitPromise makes chromedp.Evaluate resolve a returned Promise value
// (our fetch IIFE) instead of returning the pending promise handle.
func awaitPromise(p *runtime.EvaluateParams) *runtime.EvaluateParams {
	return p.WithAwaitPromise(true)
}

var (
	browserMu      sync.Mutex
	browserCtx     context.Context
	browserCancels []func()
	// Launch failures are remembered (with their reason) but not forever: a
	// transient failure — Edge busy updating, antivirus scan, a slow start
	// that timed out — must not silently degrade every later lookup to the
	// direct-HTTP fallback for the whole session.
	browserFailMsg string
	browserFailAt  time.Time

	// A single tab parked on the site with its bot challenge already
	// cleared. Lookups reuse it instead of loading a product page each time.
	warmTabCtx    context.Context
	warmTabCancel func()
	warmTabAt     time.Time
	// Consecutive warm-tab failures, and when the path was given up on. A
	// broken fast path must cost its timeout a bounded number of times, not
	// once per lookup forever — that turns a latent bug into a regression
	// slower than having no fast path at all.
	warmTabFails    int
	warmTabPausedAt time.Time
	// Bumped on every launch so an idle watcher from a previous browser
	// instance retires instead of policing its successor.
	browserGen int

	lastLookupMu sync.Mutex
	lastLookupAt time.Time
)

const (
	browserRetryAfter = 2 * time.Minute
	// How long a warmed tab is trusted before it is re-warmed. The session
	// cookies the challenge grants are good for far longer than this; the
	// re-warm mainly guards against a tab that has been navigated away or
	// quietly killed.
	warmTabMaxAge = 15 * time.Minute
	// Idle time after which the headless browser (a full Chrome, ~100-250 MB
	// across its processes) is shut down. ensureBrowser relaunches it
	// transparently on the next lookup for about a second — the same cost
	// already paid on the first lookup of a session.
	browserIdleTimeout = 10 * time.Minute
	// Bound on building the warm tab (navigate + challenge).
	warmTabSetupTimeout = 25 * time.Second
	// A warm fetch is one same-origin request on an already-open page. If it
	// has not answered in this long something is wrong, and waiting longer
	// only delays the fallback that will actually work.
	warmFetchTimeout = 8 * time.Second
	// After this many consecutive failures the warm path is skipped entirely
	// for warmTabPauseFor, so a broken fast path degrades to "no faster than
	// before" instead of "slower than before".
	warmTabMaxFails = 3
	warmTabPauseFor = 5 * time.Minute
)

// noteLookup records lookup activity for the idle-shutdown watcher.
func noteLookup() {
	lastLookupMu.Lock()
	lastLookupAt = time.Now()
	lastLookupMu.Unlock()
}

// watchBrowserIdle closes the headless browser once no lookup has run for
// browserIdleTimeout. One watcher runs per launch; gen identifies which.
func watchBrowserIdle(gen int) {
	for {
		time.Sleep(time.Minute)
		lastLookupMu.Lock()
		last := lastLookupAt
		lastLookupMu.Unlock()
		browserMu.Lock()
		stale := browserGen != gen || browserCtx == nil
		browserMu.Unlock()
		if stale {
			return // this watcher's browser is gone
		}
		if last.IsZero() || time.Since(last) < browserIdleTimeout {
			continue
		}
		log.Printf("lookup browser idle for %v — shutting it down", browserIdleTimeout)
		shutdownBrowser()
		return
	}
}

// browserExecPath returns the path to a Chromium-based browser to drive, or
// "" if none is found. ACE_BROWSER_PATH overrides (used in tests).
func browserExecPath() string {
	if p := os.Getenv("ACE_BROWSER_PATH"); p != "" {
		return p
	}
	for _, exe := range []string{"msedge.exe", "chrome.exe"} {
		if p := findWindowsBrowser(exe); p != "" {
			return p
		}
	}
	// macOS / Linux common locations
	for _, p := range []string{
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
	} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// ensureBrowser lazily launches a persistent headless browser and returns a
// base context to derive per-lookup tabs from. Reused across lookups so the
// ~1s startup is paid only once.
func ensureBrowser() (context.Context, error) {
	browserMu.Lock()
	defer browserMu.Unlock()
	if browserCtx != nil {
		return browserCtx, nil
	}
	if browserFailMsg != "" && time.Since(browserFailAt) < browserRetryAfter {
		return nil, fmt.Errorf("%s (retrying in a couple of minutes)", browserFailMsg)
	}
	exec := browserExecPath()
	if exec == "" {
		return nil, browserFailure("no Edge/Chrome found to drive lookups")
	}
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(exec),
		chromedp.Flag("headless", "new"),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("no-first-run", true),
		chromedp.Flag("no-default-browser-check", true),
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.UserAgent(userAgent),
		chromedp.WindowSize(1280, 900),
	)
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(context.Background(), opts...)
	ctx, cancelCtx := chromedp.NewContext(allocCtx)
	// Start the browser on ctx itself so ctx *owns* the browser process — then
	// per-lookup child tabs can come and go without tearing it down. Guard the
	// launch with our own timeout (a WithTimeout child that we later cancel
	// would kill the owning session).
	done := make(chan error, 1)
	go func() { done <- chromedp.Run(ctx) }()
	select {
	case err := <-done:
		if err != nil {
			cancelCtx()
			cancelAlloc()
			return nil, browserFailure(fmt.Sprintf("could not start browser: %v", err))
		}
	case <-time.After(25 * time.Second):
		cancelCtx()
		cancelAlloc()
		return nil, browserFailure("browser start timed out")
	}
	browserCtx = ctx
	browserCancels = []func(){cancelCtx, cancelAlloc}
	browserFailMsg = ""
	browserGen++
	go watchBrowserIdle(browserGen)
	return browserCtx, nil
}

// browserFailure records a launch failure (starting the retry cooldown) and
// returns it as the error, keeping the original reason for diagnostics.
func browserFailure(msg string) error {
	browserFailMsg = msg
	browserFailAt = time.Now()
	return fmt.Errorf("%s", msg)
}

type browserFetch struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
	Err    string `json:"error"`
}

// storefrontFetchJS builds the in-page fetch of the storefront pricing API.
// Run inside a page on the site, it carries that page's bot-cleared session
// and same-origin authorization — which is the whole reason a browser is
// involved at all.
func storefrontFetchJS(sku, store string) string {
	return fmt.Sprintf(`(async () => {
	  try {
	    const r = await fetch(%q + encodeURIComponent(%q) + "?purchaseLocation=" + encodeURIComponent(%q),
	      { headers: { "Accept": "application/json" }, credentials: "include" });
	    return JSON.stringify({ status: r.status, body: await r.text() });
	  } catch (e) { return JSON.stringify({ error: String(e) }); }
	})()`, "/api/commerce/catalog/storefront/products/", sku, store)
}

// pageSettled waits for the bot challenge to clear and the storefront app to
// hydrate, returning as soon as that has happened. This replaced a flat
// 1.8s sleep: the challenge only has real work to do on the first load of a
// session, so a warm lookup was paying the full wait for nothing.
func pageSettled(ctx context.Context, budget time.Duration) error {
	var ready bool
	return chromedp.Run(ctx, chromedp.Poll(
		// Either structured product data or the site's own app shell is
		// enough to know we are past the challenge and can fetch.
		`!!document.querySelector('script[type="application/ld+json"]') ||
		 !!document.querySelector('[data-mz-product], #main, main')`,
		&ready,
		chromedp.WithPollingInterval(120*time.Millisecond),
		chromedp.WithPollingTimeout(budget),
	))
}

// ensureWarmTab returns a tab parked on the site with its challenge already
// cleared, creating or refreshing it as needed. Callers must hold browserMu.
//
// The tab's target MUST be created by a Run on ctx itself, never on a
// context.WithTimeout child of it. chromedp binds the target's message-pump
// goroutine to the context of the first Run that materializes the target, so
// cancelling that child (as a defer does on return) leaves a tab whose
// executor is dead while c.Target stays non-nil: every later Evaluate is
// written into a pump nobody is reading and waits out its own deadline. That
// is what made 2.4.0 slower than the version it replaced — each lookup burned
// the full warm-tab timeout and then navigated anyway. The warm-up is bounded
// by a watchdog goroutine instead, which cancels nothing on the happy path.
func ensureWarmTab(base context.Context, diag *[]string) (context.Context, error) {
	if warmTabCtx != nil && time.Since(warmTabAt) < warmTabMaxAge {
		return warmTabCtx, nil
	}
	if warmTabCancel != nil {
		warmTabCancel()
		warmTabCtx, warmTabCancel = nil, nil
	}
	ctx, cancel := chromedp.NewContext(base)
	done := make(chan error, 1)
	go func() {
		done <- chromedp.Run(ctx,
			chromedp.Navigate(warmupProductURL),
			chromedp.WaitReady("body", chromedp.ByQuery),
		)
	}()
	select {
	case err := <-done:
		if err != nil {
			cancel()
			return nil, err
		}
	case <-time.After(warmTabSetupTimeout):
		cancel()
		return nil, fmt.Errorf("warm-up navigation timed out")
	}
	// A challenge that never settles still leaves a usable session more
	// often than not, so a timeout here is not fatal. Safe to use a timeout
	// child now: the target already exists, so this Run reuses it rather
	// than binding a new pump.
	if err := pageSettled(ctx, 6*time.Second); err != nil {
		*diag = append(*diag, "Warm-up page did not fully settle — continuing anyway")
	}
	warmTabCtx, warmTabCancel, warmTabAt = ctx, cancel, time.Now()
	*diag = append(*diag, "Opened a warm acehardware.com session tab")
	return warmTabCtx, nil
}

// dropWarmTab discards the warm tab so the next lookup builds a fresh one.
// Callers must hold browserMu.
func dropWarmTab() {
	if warmTabCancel != nil {
		warmTabCancel()
	}
	warmTabCtx, warmTabCancel = nil, nil
	warmTabAt = time.Time{}
}

// warmPathUsable reports whether the warm fast path is worth attempting.
// Callers must hold browserMu.
func warmPathUsable() bool {
	if warmTabPausedAt.IsZero() {
		return true
	}
	if time.Since(warmTabPausedAt) < warmTabPauseFor {
		return false
	}
	warmTabPausedAt, warmTabFails = time.Time{}, 0 // cooled off — try again
	return true
}

// noteWarmFailure records a failed warm attempt, pausing the path once it has
// failed warmTabMaxFails times in a row. Callers must hold browserMu.
func noteWarmFailure(diag *[]string) {
	warmTabFails++
	dropWarmTab()
	if warmTabFails >= warmTabMaxFails && warmTabPausedAt.IsZero() {
		warmTabPausedAt = time.Now()
		log.Printf("warm-tab lookup failed %d times — pausing the fast path for %v", warmTabFails, warmTabPauseFor)
		*diag = append(*diag, "Fast lookup path paused after repeated failures — using full page loads for now")
	}
}

// noteWarmSuccess clears the failure streak. Callers must hold browserMu.
func noteWarmSuccess() {
	warmTabFails = 0
	warmTabPausedAt = time.Time{}
}

// parseStorefrontPayload turns a storefront API body into product fields.
func parseStorefrontPayload(body string) (page *pageProduct, storePrice, salePrice string, ok bool) {
	var payload map[string]any
	if json.Unmarshal([]byte(body), &payload) != nil {
		return nil, "", "", false
	}
	page = &pageProduct{}
	if p, isMap := payload["price"].(map[string]any); isMap {
		storePrice = money(p["price"])
		salePrice = money(p["salePrice"])
	}
	if content, isMap := payload["content"].(map[string]any); isMap {
		page.name, _ = content["productName"].(string)
		if imgs, isArr := content["productImages"].([]any); isArr && len(imgs) > 0 {
			if im, isMap2 := imgs[0].(map[string]any); isMap2 {
				if u, isStr := im["imageUrl"].(string); isStr {
					page.image = cleanImageURL(u)
				}
			}
		}
	}
	return page, storePrice, salePrice, page.name != "" || storePrice != "" || salePrice != ""
}

// lookupSKUViaWarmTab resolves a known item number straight from the
// storefront API on the warm tab — no page navigation at all.
//
// The old path loaded the full product SPA for every SKU purely to hold a
// bot-cleared session, then made this same in-page call for the numbers that
// actually matter. Page load, hydration and a fixed sleep dominated a lookup
// (~4-6s each, all serialized on browserMu), so a 20-sign price refresh took
// minutes. Reusing one warmed tab turns each lookup into a single fetch.
// Anything this path cannot answer falls back to the full navigation below.
func lookupSKUViaWarmTab(base context.Context, sku, store string, diag *[]string) (page *pageProduct, storePrice, salePrice, finalURL string, ok bool) {
	if !warmPathUsable() {
		return nil, "", "", "", false
	}
	tab, err := ensureWarmTab(base, diag)
	if err != nil {
		*diag = append(*diag, "Could not open a warm session tab: "+err.Error())
		noteWarmFailure(diag)
		return nil, "", "", "", false
	}
	runCtx, cancel := context.WithTimeout(tab, warmFetchTimeout)
	defer cancel()

	var raw string
	if err := chromedp.Run(runCtx, chromedp.Evaluate(storefrontFetchJS(sku, store), &raw, awaitPromise)); err != nil {
		*diag = append(*diag, "Warm-tab price fetch failed: "+err.Error())
		noteWarmFailure(diag) // tab is unusable (closed, crashed, navigated away)
		return nil, "", "", "", false
	}
	var bf browserFetch
	if json.Unmarshal([]byte(raw), &bf) != nil {
		return nil, "", "", "", false
	}
	if bf.Err != "" {
		*diag = append(*diag, "In-page price fetch error: "+bf.Err)
		return nil, "", "", "", false
	}
	if bf.Status != 200 {
		// 401/403 means the session went stale — re-warm on the next attempt.
		// That is an expected, self-healing condition rather than a fault of
		// the fast path, so it must not count toward the circuit breaker.
		if bf.Status == 401 || bf.Status == 403 {
			dropWarmTab()
		}
		*diag = append(*diag, fmt.Sprintf("In-page price API returned HTTP %d", bf.Status))
		return nil, "", "", "", false
	}
	page, storePrice, salePrice, ok = parseStorefrontPayload(bf.Body)
	if !ok {
		*diag = append(*diag, "Store API returned no usable product fields")
		return nil, "", "", "", false
	}
	noteWarmSuccess()
	page.sku = sku
	*diag = append(*diag, fmt.Sprintf("Store price via warm session for store %s: %s (sale: %s)", store, orDash(storePrice), orDash(salePrice)))
	return page, storePrice, salePrice, baseSite + "/product/" + sku, true
}

// lookupViaBrowser loads the product page in a real browser (resolving a
// search phrase to a product first when needed), then runs the storefront
// pricing API call from inside that page so it inherits the site's
// bot-cleared session and authorization. Returns parsed content + prices and
// the final product URL.
func lookupViaBrowser(startURL string, isSearch bool, knownSKU, store string, diag *[]string) (page *pageProduct, storePrice, salePrice, finalURL string, ok bool) {
	base, err := ensureBrowser()
	if err != nil {
		*diag = append(*diag, "Browser lookup unavailable: "+err.Error())
		return nil, "", "", "", false
	}
	noteLookup()

	// Serialize lookups onto the shared browser; make each a fresh tab.
	browserMu.Lock()
	defer browserMu.Unlock()

	// Fast path: a plain item number needs nothing but the storefront API,
	// which the warm tab can call directly.
	if knownSKU != "" && !isSearch {
		if page, sp, salep, url, ok := lookupSKUViaWarmTab(base, knownSKU, store, diag); ok {
			return page, sp, salep, url, true
		}
		*diag = append(*diag, "Warm session couldn't answer — loading the full product page")
	}

	tabCtx, cancelTab := chromedp.NewContext(base)
	defer cancelTab()
	// 20s is ample for a page load once the browser is already running; the
	// old 40s meant a hung site stalled each SKU for most of a minute before
	// the HTTP fallback even started.
	runCtx, cancelRun := context.WithTimeout(tabCtx, 20*time.Second)
	defer cancelRun()

	// Phase 1: navigate; for a search, hop to the first product link.
	var html string
	if err := chromedp.Run(runCtx,
		chromedp.Navigate(startURL),
		chromedp.WaitReady("body", chromedp.ByQuery),
	); err != nil {
		*diag = append(*diag, "Browser navigation failed: "+err.Error())
		return nil, "", "", "", false
	}
	_ = pageSettled(runCtx, 6*time.Second) // best effort: parse what's there either way
	if isSearch {
		var href string
		_ = chromedp.Run(runCtx, chromedp.Evaluate(
			`(() => {
			   const as = [...document.querySelectorAll('a[href]')];
			   const hit = as.find(a => {
			     const h = a.getAttribute('href') || '';
			     return /\/(product|p)\//.test(h) || /\/\d{5,9}(?:$|\?|#)/.test(h);
			   });
			   return hit ? hit.href : "";
			 })()`, &href))
		if href == "" {
			*diag = append(*diag, "Browser search returned no product links")
			return nil, "", "", "", false
		}
		*diag = append(*diag, "Search resolved to "+href)
		if err := chromedp.Run(runCtx,
			chromedp.Navigate(href),
			chromedp.WaitReady("body", chromedp.ByQuery),
		); err != nil {
			*diag = append(*diag, "Browser could not open the search result: "+err.Error())
			return nil, "", "", "", false
		}
		_ = pageSettled(runCtx, 5*time.Second)
	}
	_ = chromedp.Run(runCtx,
		chromedp.Location(&finalURL),
		chromedp.OuterHTML("html", &html, chromedp.ByQuery),
	)
	*diag = append(*diag, "Loaded the product page in a real browser session")

	// Resolve the item number from the rendered page if we don't have one.
	sku := knownSKU
	ld := parseJSONLD(html)
	if sku == "" && ld != nil && ld.sku != "" {
		sku = ld.sku
	}
	if sku == "" {
		if m := skuJSONRe.FindStringSubmatch(html); m != nil {
			sku = m[1]
		}
	}

	// Phase 2: authoritative store price via an in-page fetch (same origin,
	// bot-cleared session), when we have an item number.
	var apiRaw string
	if sku != "" {
		_ = chromedp.Run(runCtx, chromedp.Evaluate(storefrontFetchJS(sku, store), &apiRaw, awaitPromise))
	}

	// Parse the in-page API fetch (authoritative store price).
	if apiRaw != "" {
		var bf browserFetch
		if json.Unmarshal([]byte(apiRaw), &bf) == nil {
			if bf.Err != "" {
				*diag = append(*diag, "In-page price fetch error: "+bf.Err)
			} else if bf.Status != 200 {
				*diag = append(*diag, fmt.Sprintf("In-page price API returned HTTP %d", bf.Status))
			} else {
				var payload map[string]any
				if json.Unmarshal([]byte(bf.Body), &payload) == nil {
					if p, ok2 := payload["price"].(map[string]any); ok2 {
						storePrice = money(p["price"])
						salePrice = money(p["salePrice"])
					}
					page = &pageProduct{sku: sku}
					if content, ok2 := payload["content"].(map[string]any); ok2 {
						page.name, _ = content["productName"].(string)
						if imgs, ok3 := content["productImages"].([]any); ok3 && len(imgs) > 0 {
							if im, ok4 := imgs[0].(map[string]any); ok4 {
								if u, ok5 := im["imageUrl"].(string); ok5 {
									page.image = cleanImageURL(u)
								}
							}
						}
					}
					if storePrice != "" || salePrice != "" {
						*diag = append(*diag, fmt.Sprintf("Store price via browser for store %s: %s (sale: %s)", store, orDash(storePrice), orDash(salePrice)))
					}
				}
			}
		}
	}

	// Rendered-DOM fallbacks (JSON-LD survives the SPA render).
	if ld != nil {
		*diag = append(*diag, "Structured product data (JSON-LD) parsed from rendered page")
		if page == nil {
			page = ld
			page.image = cleanImageURL(page.image)
		} else {
			if page.name == "" {
				page.name = ld.name
			}
			if page.image == "" {
				page.image = cleanImageURL(ld.image)
			}
			if page.brand == "" {
				page.brand = ld.brand
			}
			if page.desc == "" {
				page.desc = ld.desc
			}
			if page.price == "" {
				page.price = ld.price
			}
			if page.sku == "" {
				page.sku = ld.sku
			}
		}
	}
	if page != nil && page.name == "" {
		if m := ogTitleRe.FindStringSubmatch(html); m != nil {
			page.name = htmlUnescape(m[1])
		} else if m := titleTagRe.FindStringSubmatch(html); m != nil {
			page.name = strings.TrimSpace(strings.Split(htmlUnescape(m[1]), " - ")[0])
		}
	}
	if page != nil && page.image == "" {
		if m := ogImageRe.FindStringSubmatch(html); m != nil {
			page.image = cleanImageURL(m[1])
		}
	}
	if page != nil && page.sku == "" {
		page.sku = sku
	}

	ok = page != nil && (page.name != "" || storePrice != "" || salePrice != "")
	if !ok {
		*diag = append(*diag, "Browser session loaded but no product data was found on the page")
	}
	return page, storePrice, salePrice, finalURL, ok
}

// shutdownBrowser tears down the persistent browser (best-effort).
func shutdownBrowser() {
	browserMu.Lock()
	defer browserMu.Unlock()
	dropWarmTab()
	for i := len(browserCancels) - 1; i >= 0; i-- {
		browserCancels[i]()
	}
	browserCancels = nil
	browserCtx = nil
}
