package main

// Lookup tests run entirely against an httptest mock of acehardware.com
// (the ACE_BASE_URL seam), with ACE_LOOKUP_MODE=http forcing the direct
// path — no browser, no real network.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type mockProduct struct {
	name  string
	price float64
	sale  float64 // 0 = not on sale
}

// mockAce mirrors the endpoints doLookup touches: product pages with
// JSON-LD, the Mozu storefront price API, and site search.
func mockAce(t *testing.T, products map[string]mockProduct) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		base := srv.URL
		if api := strings.TrimPrefix(r.URL.Path, "/api/commerce/catalog/storefront/products/"); api != r.URL.Path {
			p, ok := products[api]
			if !ok {
				http.Error(w, "{}", http.StatusNotFound)
				return
			}
			price := map[string]any{"price": p.price}
			if p.sale > 0 {
				price["salePrice"] = p.sale
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"price": price,
				"content": map[string]any{
					"productName":   p.name,
					"productImages": []any{map[string]any{"imageUrl": base + "/img/" + api + ".png"}},
				},
			})
			return
		}
		if sku := strings.TrimPrefix(r.URL.Path, "/product/"); sku != r.URL.Path {
			p, ok := products[sku]
			if !ok {
				http.Error(w, "<html><body></body></html>", http.StatusNotFound)
				return
			}
			offer := p.price
			if p.sale > 0 {
				offer = p.sale
			}
			ld := fmt.Sprintf(`{"@context":"https://schema.org","@type":"Product","name":%q,"sku":%q,`+
				`"image":%q,"brand":{"@type":"Brand","name":"Ace"},`+
				`"offers":{"@type":"Offer","price":"%.2f","priceCurrency":"USD"}}`,
				p.name, sku, base+"/img/"+sku+".png", offer)
			fmt.Fprintf(w, `<html><head><title>%s</title><script type="application/ld+json">%s</script></head><body></body></html>`, p.name, ld)
			return
		}
		if r.URL.Path == "/meta-only" {
			fmt.Fprint(w, `<html><head><meta property="og:title" content="Meta Fallback Hammer"/>`+
				`<meta property="og:image" content="`+base+`/img/meta.png"/></head>`+
				`<body>"productCode":"1234567"</body></html>`)
			return
		}
		if r.URL.Path == "/search" {
			fmt.Fprint(w, `<html><body><a href="/product/3000003">DeWalt Drill</a></body></html>`)
			return
		}
		fmt.Fprint(w, "<html><body>mock</body></html>")
	}))
	t.Cleanup(srv.Close)

	oldBase, oldWarm, oldAPI := baseSite, warmupProductURL, storefrontAPI
	baseSite = srv.URL
	warmupProductURL = srv.URL + "/product/8315087"
	storefrontAPI = srv.URL + "/api/commerce/catalog/storefront/products/"
	t.Cleanup(func() { baseSite, warmupProductURL, storefrontAPI = oldBase, oldWarm, oldAPI })

	t.Setenv("ACE_LOOKUP_MODE", "http")
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())
	resetLookupState()
	return srv
}

func resetLookupState() {
	sessionMu.Lock()
	session = nil
	sessionMu.Unlock()
	lookupMu.Lock()
	lookupCache = map[string]cacheEntry{}
	diskCacheOnce = sync.Once{}
	lookupMu.Unlock()
}

var testProducts = map[string]mockProduct{
	"3000003": {name: "DeWalt 20V MAX Drill Kit", price: 129.00},
	"2000002": {name: "Scotts Turf Builder 5M", price: 24.99, sale: 19.99},
	"8315087": {name: "Warmup Product", price: 1.00},
}

func TestLookupSKUHappyPath(t *testing.T) {
	mockAce(t, testProducts)
	res := lookupProduct("3000003", "12180", false)
	if !res.OK {
		t.Fatalf("lookup failed: %+v", res)
	}
	if res.Name != "DeWalt 20V MAX Drill Kit" {
		t.Errorf("name = %q", res.Name)
	}
	if res.Price != "129.00" {
		t.Errorf("price = %q, want 129.00", res.Price)
	}
	if res.SalePrice != "" {
		t.Errorf("salePrice = %q, want empty", res.SalePrice)
	}
	if res.SKU != "3000003" {
		t.Errorf("sku = %q", res.SKU)
	}
	if !strings.HasSuffix(res.ImageURL, "?max=800") {
		t.Errorf("imageURL not normalized: %q", res.ImageURL)
	}
}

func TestLookupSaleDetection(t *testing.T) {
	mockAce(t, testProducts)
	res := lookupProduct("2000002", "12180", false)
	if !res.OK || res.Price != "24.99" || res.SalePrice != "19.99" {
		t.Errorf("sale lookup = price %q sale %q ok %v", res.Price, res.SalePrice, res.OK)
	}
}

func TestLookupMetaTagFallback(t *testing.T) {
	srv := mockAce(t, testProducts)
	res := lookupProduct(srv.URL+"/meta-only", "12180", false)
	if !res.OK {
		t.Fatalf("lookup failed: %+v", res)
	}
	if res.Name != "Meta Fallback Hammer" {
		t.Errorf("name = %q", res.Name)
	}
	if res.SKU != "1234567" {
		t.Errorf("sku from embedded JSON = %q", res.SKU)
	}
	if !strings.Contains(res.ImageURL, "/img/meta.png") {
		t.Errorf("og:image not used: %q", res.ImageURL)
	}
}

func TestLookupSearchPhrase(t *testing.T) {
	mockAce(t, testProducts)
	res := lookupProduct("dewalt drill", "12180", false)
	if !res.OK || res.SKU != "3000003" {
		t.Errorf("search lookup = sku %q ok %v (%v)", res.SKU, res.OK, res.Diagnostics)
	}
}

func TestLookupUnknownSKUFails(t *testing.T) {
	mockAce(t, testProducts)
	res := lookupProduct("4040404", "12180", false)
	if res.OK {
		t.Errorf("expected failure, got %+v", res)
	}
	if res.Error == "" {
		t.Error("expected an error message")
	}
}

func TestDiskCacheRoundTrip(t *testing.T) {
	mockAce(t, testProducts)
	res := lookupProduct("3000003", "12180", false)
	if !res.OK {
		t.Fatalf("seed lookup failed: %+v", res)
	}
	p, _ := lookupCachePath()
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("lookup-cache.json not written: %v", err)
	}

	// fresh process state, same config dir → served from the disk cache
	sessionMu.Lock()
	session = nil
	sessionMu.Unlock()
	lookupMu.Lock()
	lookupCache = map[string]cacheEntry{}
	diskCacheOnce = sync.Once{}
	lookupMu.Unlock()

	res2 := lookupProduct("3000003", "12180", false)
	if !res2.OK || res2.Price != "129.00" {
		t.Fatalf("disk-cached lookup failed: %+v", res2)
	}
	if len(res2.Diagnostics) == 0 || !strings.Contains(res2.Diagnostics[0], "cache") {
		t.Errorf("expected cache diagnostic, got %v", res2.Diagnostics)
	}
}

// writeCacheFile plants a lookup-cache.json entry with a given age.
func writeCacheFile(t *testing.T, key string, res LookupResult, age time.Duration) {
	t.Helper()
	p, err := lookupCachePath()
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(map[string]diskCacheEntry{
		key: {Res: res, At: time.Now().Add(-age)},
	})
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStaleCacheServedWhenLiveFails(t *testing.T) {
	mockAce(t, map[string]mockProduct{}) // every live lookup 404s
	writeCacheFile(t, "12180|3000003", LookupResult{
		OK: true, SKU: "3000003", Name: "Cached Drill", Price: "129.00",
	}, 2*time.Hour)

	res := lookupProduct("3000003", "12180", false)
	if !res.OK || res.Name != "Cached Drill" {
		t.Fatalf("stale cache not served: %+v", res)
	}
	if len(res.Diagnostics) == 0 || !strings.Contains(res.Diagnostics[0], "Live lookup failed") {
		t.Errorf("expected stale diagnostic, got %v", res.Diagnostics)
	}
}

func TestExpiredCacheNotServed(t *testing.T) {
	mockAce(t, map[string]mockProduct{})
	writeCacheFile(t, "12180|3000003", LookupResult{
		OK: true, SKU: "3000003", Name: "Ancient Drill", Price: "99.00",
	}, 8*24*time.Hour)

	res := lookupProduct("3000003", "12180", false)
	if res.OK {
		t.Fatalf("8-day-old cache should not rescue a failed lookup: %+v", res)
	}
}

func TestFreshCacheAvoidsNetwork(t *testing.T) {
	srv := mockAce(t, testProducts)
	if res := lookupProduct("3000003", "12180", false); !res.OK {
		t.Fatalf("seed lookup failed: %+v", res)
	}
	srv.Close() // no server anymore — a cache hit is the only way to succeed
	res := lookupProduct("3000003", "12180", false)
	if !res.OK || res.Price != "129.00" {
		t.Fatalf("fresh cache should serve without network: %+v", res)
	}
}

func TestImageProxyHostAllowlist(t *testing.T) {
	if _, _, err := fetchImageCached("https://evil.example.com/x.png"); err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Errorf("disallowed host should error, got %v", err)
	}
	if _, _, err := fetchImageCached("ftp://acehardware.com/x.png"); err == nil {
		t.Error("non-http scheme should error")
	}
}

func TestMoneyAndImageURLHelpers(t *testing.T) {
	if money(12.5) != "12.50" || money("7") != "7.00" || money(nil) != "" {
		t.Error("money() formatting broken")
	}
	got := cleanImageURL("//example.acehardware.com/img/x.jpg?w=100")
	if got != "https://example.acehardware.com/img/x.jpg?max=800" {
		t.Errorf("cleanImageURL = %q", got)
	}
}

func TestConfigDirOverride(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "cfg")
	t.Setenv("ACE_CONFIG_DIR", dir)
	got, err := configDir()
	if err != nil || got != dir {
		t.Fatalf("configDir = %q, %v", got, err)
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		t.Error("override dir not created")
	}
}
