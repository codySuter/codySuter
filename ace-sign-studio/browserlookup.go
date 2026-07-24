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
)

const browserRetryAfter = 2 * time.Minute

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

	// Serialize lookups onto the shared browser; make each a fresh tab.
	browserMu.Lock()
	defer browserMu.Unlock()

	tabCtx, cancelTab := chromedp.NewContext(base)
	defer cancelTab()
	runCtx, cancelRun := context.WithTimeout(tabCtx, 40*time.Second)
	defer cancelRun()

	// Phase 1: navigate; for a search, hop to the first product link.
	var html string
	if err := chromedp.Run(runCtx,
		chromedp.Navigate(startURL),
		chromedp.WaitReady("body", chromedp.ByQuery),
		chromedp.Sleep(1800*time.Millisecond), // let the challenge clear + app hydrate
	); err != nil {
		*diag = append(*diag, "Browser navigation failed: "+err.Error())
		return nil, "", "", "", false
	}
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
			chromedp.Sleep(1500*time.Millisecond),
		); err != nil {
			*diag = append(*diag, "Browser could not open the search result: "+err.Error())
			return nil, "", "", "", false
		}
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
		fetchJS := fmt.Sprintf(`(async () => {
		  try {
		    const r = await fetch(%q + encodeURIComponent(%q) + "?purchaseLocation=" + encodeURIComponent(%q),
		      { headers: { "Accept": "application/json" }, credentials: "include" });
		    return JSON.stringify({ status: r.status, body: await r.text() });
		  } catch (e) { return JSON.stringify({ error: String(e) }); }
		})()`, "/api/commerce/catalog/storefront/products/", sku, store)
		_ = chromedp.Run(runCtx, chromedp.Evaluate(fetchJS, &apiRaw, awaitPromise))
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
	for i := len(browserCancels) - 1; i >= 0; i-- {
		browserCancels[i]()
	}
	browserCancels = nil
	browserCtx = nil
}
