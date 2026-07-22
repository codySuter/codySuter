package main

// Product lookup against acehardware.com, ported from the two legacy tools:
//
//   - Cody's Outdoor Signage Tool v19 (Python): warms Mozu auth cookies by
//     loading a product page, then calls the storefront catalog API with
//     purchaseLocation=<store> for the store-specific price, and parses the
//     product page's JSON-LD for name/image.
//   - Ace Sign Studio for Mac (Swift): layered fallbacks (direct product URL,
//     search, embedded JSON, meta tags) with a step-by-step diagnostics log.
//
// Every lookup returns a diagnostics trail so a failed parse can be debugged
// from inside the app instead of guessing.

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultStoreCode = "12180" // Snyder's Ace Hardware
	userAgent        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
)

// baseSite is overridable via ACE_BASE_URL for testing against a mock server.
var (
	baseSite         = "https://www.acehardware.com"
	warmupProductURL string
	storefrontAPI    string
)

func init() {
	if v := os.Getenv("ACE_BASE_URL"); v != "" {
		baseSite = strings.TrimRight(v, "/")
	}
	warmupProductURL = baseSite + "/product/8315087"
	storefrontAPI = baseSite + "/api/commerce/catalog/storefront/products/"
}

type LookupResult struct {
	OK          bool     `json:"ok"`
	Query       string   `json:"query"`
	SKU         string   `json:"sku,omitempty"`
	Name        string   `json:"name,omitempty"`
	Brand       string   `json:"brand,omitempty"`
	Description string   `json:"description,omitempty"`
	Price       string   `json:"price,omitempty"`     // store price (2dp)
	SalePrice   string   `json:"salePrice,omitempty"` // store sale price (2dp)
	ListPrice   string   `json:"listPrice,omitempty"` // site/list price fallback
	ImageURL    string   `json:"imageUrl,omitempty"`  // remote URL (use /api/img?u=)
	ProductURL  string   `json:"productUrl,omitempty"`
	Error       string   `json:"error,omitempty"`
	Diagnostics []string `json:"diagnostics"`
}

type cacheEntry struct {
	res LookupResult
	at  time.Time
}

var (
	sessionMu   sync.Mutex
	session     *http.Client
	lookupMu    sync.Mutex
	lookupCache = map[string]cacheEntry{}
	cacheTTL    = time.Hour

	imgCacheMu  sync.Mutex
	imgCacheDir string
)

// getSession returns a shared HTTP client whose cookie jar has been warmed on
// a real product page, which is what authorizes the storefront API calls.
func getSession(forceRefresh bool) *http.Client {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	if session == nil || forceRefresh {
		jar, _ := cookiejar.New(nil)
		session = &http.Client{Jar: jar, Timeout: 20 * time.Second}
		req, _ := http.NewRequest("GET", warmupProductURL, nil)
		setBrowserHeaders(req, "")
		if resp, err := session.Do(req); err == nil {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
		}
	}
	return session
}

func siteGet(c *http.Client, rawURL string, accept string) (*http.Response, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	setBrowserHeaders(req, accept)
	return c.Do(req)
}

// setBrowserHeaders makes requests present like a current Chrome on Windows —
// acehardware.com sits behind bot protection that scores stale user agents
// and header-less clients.
func setBrowserHeaders(req *http.Request, accept string) {
	req.Header.Set("User-Agent", userAgent)
	if accept != "" {
		req.Header.Set("Accept", accept)
		req.Header.Set("Referer", baseSite+"/")
		req.Header.Set("Sec-Fetch-Dest", "empty")
		req.Header.Set("Sec-Fetch-Mode", "cors")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
	} else {
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
		req.Header.Set("Sec-Fetch-Dest", "document")
		req.Header.Set("Sec-Fetch-Mode", "navigate")
		req.Header.Set("Sec-Fetch-Site", "none")
		req.Header.Set("Sec-Fetch-User", "?1")
		req.Header.Set("Upgrade-Insecure-Requests", "1")
	}
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("sec-ch-ua", `"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"`)
	req.Header.Set("sec-ch-ua-mobile", "?0")
	req.Header.Set("sec-ch-ua-platform", `"Windows"`)
}

// fetchStorePrice queries the Mozu storefront API for the store-specific
// price. Returns price, salePrice ("" when absent) plus whatever product
// content the API exposes (name/image) as bonus fields.
func fetchStorePrice(sku, store string, diag *[]string) (price, sale, apiName, apiImage string) {
	for attempt := 0; attempt < 2; attempt++ {
		c := getSession(attempt > 0)
		u := storefrontAPI + url.PathEscape(sku) + "?purchaseLocation=" + url.QueryEscape(store)
		resp, err := siteGet(c, u, "application/json")
		if err != nil {
			*diag = append(*diag, "Store API request failed: "+err.Error())
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && attempt == 0 {
			*diag = append(*diag, fmt.Sprintf("Store API returned %d — refreshing session cookies and retrying", resp.StatusCode))
			continue
		}
		if resp.StatusCode != http.StatusOK {
			*diag = append(*diag, fmt.Sprintf("Store API returned HTTP %d", resp.StatusCode))
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			*diag = append(*diag, "Store API returned unparseable JSON")
			return
		}
		if p, ok := payload["price"].(map[string]any); ok {
			price = money(p["price"])
			sale = money(p["salePrice"])
		}
		if content, ok := payload["content"].(map[string]any); ok {
			apiName, _ = content["productName"].(string)
			if imgs, ok := content["productImages"].([]any); ok && len(imgs) > 0 {
				if im, ok := imgs[0].(map[string]any); ok {
					if u, ok := im["imageUrl"].(string); ok {
						apiImage = cleanImageURL(u)
					}
				}
			}
		}
		if price != "" || sale != "" {
			*diag = append(*diag, fmt.Sprintf("Store API price for store %s: %s (sale: %s)", store, orDash(price), orDash(sale)))
		} else {
			*diag = append(*diag, "Store API response had no price fields")
		}
		return
	}
	return
}

func money(v any) string {
	switch n := v.(type) {
	case float64:
		return strconv.FormatFloat(n, 'f', 2, 64)
	case string:
		if f, err := strconv.ParseFloat(n, 64); err == nil {
			return strconv.FormatFloat(f, 'f', 2, 64)
		}
	}
	return ""
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

// cleanImageURL normalizes a product image URL to high-res HTTPS, matching
// the legacy _clean_image_url behavior.
func cleanImageURL(raw string) string {
	if raw == "" {
		return ""
	}
	u := raw
	if strings.HasPrefix(u, "//") {
		u = "https:" + u
	}
	if i := strings.Index(u, "?"); i >= 0 {
		u = u[:i]
	}
	return u + "?max=800"
}

var (
	jsonLDRe   = regexp.MustCompile(`(?is)<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>`)
	ogImageRe  = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']`)
	ogTitleRe  = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']`)
	titleTagRe = regexp.MustCompile(`(?is)<title>(.*?)</title>`)
	prodLinkRe = regexp.MustCompile(`href=["'](/[^"']*?/(\d{5,9}))["']`)
	skuJSONRe  = regexp.MustCompile(`"productCode"\s*:\s*"(\d+)"`)
)

type pageProduct struct {
	name, brand, desc, image, price, sku string
}

// parseJSONLD walks all JSON-LD blocks on a product page and extracts the
// Product (or ProductGroup) entity, mirroring _parse_jsonld_product.
func parseJSONLD(html string) *pageProduct {
	for _, m := range jsonLDRe.FindAllStringSubmatch(html, -1) {
		var node any
		if err := json.Unmarshal([]byte(strings.TrimSpace(m[1])), &node); err != nil {
			continue
		}
		if p := findProductNode(node); p != nil {
			return p
		}
	}
	return nil
}

func findProductNode(node any) *pageProduct {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			if p := findProductNode(item); p != nil {
				return p
			}
		}
	case map[string]any:
		if g, ok := v["@graph"]; ok {
			if p := findProductNode(g); p != nil {
				return p
			}
		}
		t := typeString(v["@type"])
		if t == "Product" || t == "ProductGroup" {
			p := &pageProduct{}
			p.name, _ = v["name"].(string)
			p.desc, _ = v["description"].(string)
			p.sku = stringish(v["sku"])
			switch b := v["brand"].(type) {
			case string:
				p.brand = b
			case map[string]any:
				p.brand, _ = b["name"].(string)
			}
			p.image = firstImage(v["image"])
			p.price = offerPrice(v["offers"])
			if p.price == "" {
				if vars, ok := v["hasVariant"].([]any); ok && len(vars) > 0 {
					if vm, ok := vars[0].(map[string]any); ok {
						p.price = offerPrice(vm["offers"])
					}
				}
			}
			return p
		}
	}
	return nil
}

func typeString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		for _, x := range t {
			if s, ok := x.(string); ok && (s == "Product" || s == "ProductGroup") {
				return s
			}
		}
	}
	return ""
}

func stringish(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	}
	return ""
}

func firstImage(v any) string {
	switch im := v.(type) {
	case string:
		return im
	case []any:
		if len(im) > 0 {
			if s, ok := im[0].(string); ok {
				return s
			}
		}
	case map[string]any:
		if u, ok := im["url"].(string); ok {
			return u
		}
	}
	return ""
}

func offerPrice(v any) string {
	switch o := v.(type) {
	case map[string]any:
		if p := money(o["price"]); p != "" {
			return p
		}
		if p := money(o["lowPrice"]); p != "" {
			return p
		}
	case []any:
		for _, item := range o {
			if p := offerPrice(item); p != "" {
				return p
			}
		}
	}
	return ""
}

func fetchProductPage(pageURL string, diag *[]string) (string, string, bool) {
	c := getSession(false)
	resp, err := siteGet(c, pageURL, "")
	if err != nil {
		*diag = append(*diag, "Product page request failed: "+err.Error())
		return "", "", false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 6<<20))
	finalURL := resp.Request.URL.String()
	if resp.StatusCode != http.StatusOK {
		*diag = append(*diag, fmt.Sprintf("Product page returned HTTP %d", resp.StatusCode))
		return "", finalURL, false
	}
	*diag = append(*diag, "Product page loaded: "+finalURL)
	return string(body), finalURL, true
}

var skuRe = regexp.MustCompile(`^\d{4,9}$`)

// lookupProduct resolves a SKU, pasted URL, or search phrase into sign-ready
// product data with the store-specific price.
func lookupProduct(query, store string, refresh bool) LookupResult {
	key := store + "|" + query
	if !refresh {
		lookupMu.Lock()
		if e, ok := lookupCache[key]; ok && time.Since(e.at) < cacheTTL {
			lookupMu.Unlock()
			cached := e.res
			cached.Diagnostics = append([]string{"Served from 1-hour cache"}, cached.Diagnostics...)
			return cached
		}
		lookupMu.Unlock()
	}

	res := doLookup(query, store)
	if res.OK {
		lookupMu.Lock()
		lookupCache[key] = cacheEntry{res: res, at: time.Now()}
		lookupMu.Unlock()
	}
	return res
}

func doLookup(query, store string) LookupResult {
	diag := []string{}
	res := LookupResult{Query: query}

	sku := ""
	pageURL := ""
	q := strings.TrimSpace(query)
	switch {
	case skuRe.MatchString(q):
		sku = q
		pageURL = baseSite + "/product/" + sku
		diag = append(diag, "Treating input as SKU "+sku)
	case strings.HasPrefix(q, "http://") || strings.HasPrefix(q, "https://"):
		pageURL = q
		diag = append(diag, "Treating input as a product URL")
	default:
		diag = append(diag, "Treating input as a search phrase")
		found, d := searchForProduct(q)
		diag = append(diag, d...)
		if found == "" {
			res.Error = "Nothing matched \"" + q + "\" on acehardware.com."
			res.Diagnostics = diag
			return res
		}
		pageURL = found
	}

	html, finalURL, ok := fetchProductPage(pageURL, &diag)
	var page *pageProduct
	if ok {
		page = parseJSONLD(html)
		if page != nil {
			diag = append(diag, "Structured product data (JSON-LD) parsed")
			if sku == "" && page.sku != "" {
				sku = page.sku
				diag = append(diag, "Item number from page: "+sku)
			}
		} else {
			diag = append(diag, "No JSON-LD product block on the page — falling back to meta tags")
			page = &pageProduct{}
			if m := ogTitleRe.FindStringSubmatch(html); m != nil {
				page.name = htmlUnescape(m[1])
			} else if m := titleTagRe.FindStringSubmatch(html); m != nil {
				page.name = strings.TrimSpace(htmlUnescape(m[1]))
			}
			if m := ogImageRe.FindStringSubmatch(html); m != nil {
				page.image = m[1]
			}
			if sku == "" {
				if m := skuJSONRe.FindStringSubmatch(html); m != nil {
					sku = m[1]
					diag = append(diag, "Item number from embedded JSON: "+sku)
				}
			}
		}
	}

	if sku == "" {
		res.Error = "Couldn't determine an item number for \"" + query + "\"."
		res.Diagnostics = diag
		return res
	}

	price, sale, apiName, apiImage := fetchStorePrice(sku, store, &diag)

	res.SKU = sku
	res.ProductURL = finalURL
	if res.ProductURL == "" {
		res.ProductURL = baseSite + "/product/" + sku
	}
	if page != nil {
		res.Name = strings.TrimSpace(page.name)
		res.Brand = page.brand
		res.Description = page.desc
		res.ListPrice = page.price
		res.ImageURL = cleanImageURL(page.image)
	}
	if res.Name == "" && apiName != "" {
		res.Name = apiName
		diag = append(diag, "Product name taken from store API")
	}
	if apiImage != "" {
		// Store API image is authoritative when present (matches the Mac app).
		res.ImageURL = apiImage
		diag = append(diag, "Photo taken from the store API (authoritative)")
	}
	res.Price = price
	res.SalePrice = sale
	if res.Price == "" && res.ListPrice != "" {
		diag = append(diag, "Store-specific price unavailable — using site price. Double-check the price on acehardware.com")
	}
	res.OK = res.Name != "" || res.Price != "" || res.ListPrice != ""
	if !res.OK {
		res.Error = "No product data found for \"" + query + "\"."
	}
	res.Diagnostics = diag
	return res
}

// searchForProduct runs a site search and returns the first product page URL.
func searchForProduct(q string) (string, []string) {
	diag := []string{}
	c := getSession(false)
	u := baseSite + "/search?query=" + url.QueryEscape(q)
	resp, err := siteGet(c, u, "")
	if err != nil {
		return "", append(diag, "Search request failed: "+err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 6<<20))
	finalURL := resp.Request.URL.String()
	if strings.Contains(finalURL, "/product/") || strings.Contains(finalURL, "/p/") {
		diag = append(diag, "Search redirected straight to the product page")
		return finalURL, diag
	}
	html := string(body)
	if m := prodLinkRe.FindStringSubmatch(html); m != nil {
		diag = append(diag, "Search results page received — using first product link")
		href := m[1]
		if strings.HasPrefix(href, "/") {
			href = baseSite + href
		}
		return href, diag
	}
	if m := skuJSONRe.FindStringSubmatch(html); m != nil {
		diag = append(diag, "Search results had an embedded item number "+m[1])
		return baseSite + "/product/" + m[1], diag
	}
	return "", append(diag, "No product links in the search results")
}

func htmlUnescape(s string) string {
	r := strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&#39;", "'", "&#34;", `"`)
	return r.Replace(s)
}

// fetchImageCached downloads an image once per session, restricted to
// acehardware.com and its image CDNs.
func fetchImageCached(raw string) ([]byte, string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, "", fmt.Errorf("bad image url")
	}
	host := strings.ToLower(u.Hostname())
	if bu, err2 := url.Parse(baseSite); err2 == nil && strings.EqualFold(u.Host, bu.Host) {
		host = "www.acehardware.com" // ACE_BASE_URL test override
	}
	allowed := strings.HasSuffix(host, "acehardware.com") ||
		strings.HasSuffix(host, "mozu.com") ||
		strings.HasSuffix(host, "kibocommerce.com") ||
		strings.HasSuffix(host, "cloudfront.net") ||
		strings.HasSuffix(host, "scene7.com")
	if !allowed {
		return nil, "", fmt.Errorf("image host not allowed: %s", host)
	}

	imgCacheMu.Lock()
	if imgCacheDir == "" {
		imgCacheDir = filepath.Join(os.TempDir(), "ace-sign-studio-img")
		_ = os.MkdirAll(imgCacheDir, 0o755)
	}
	dir := imgCacheDir
	imgCacheMu.Unlock()

	sum := sha1.Sum([]byte(raw))
	base := filepath.Join(dir, hex.EncodeToString(sum[:]))
	if data, err := os.ReadFile(base); err == nil {
		ctype, _ := os.ReadFile(base + ".ct")
		return data, string(ctype), nil
	}

	c := getSession(false)
	resp, err := siteGet(c, raw, "")
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("image fetch HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, "", err
	}
	ctype := resp.Header.Get("Content-Type")
	if ctype == "" {
		ctype = "image/jpeg"
	}
	_ = os.WriteFile(base, data, 0o644)
	_ = os.WriteFile(base+".ct", []byte(ctype), 0o644)
	return data, ctype, nil
}
