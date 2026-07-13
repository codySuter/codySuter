"""acehardware.com product + store-price lookup for Ace Sign Studio (Windows).

Ports the macOS app's proven approach to Python:

1. Open the direct product page  acehardware.com/product/{sku}  (numeric SKUs)
   and read name / photo / description from it.
2. Call the Kibo/Mozu storefront API
   /api/commerce/catalog/storefront/products/{code}?purchaseLocation={store}
   for the price SPECIFIC to the store (incl. sale price), trying several
   candidate item codes because a product like the bird seed is paged as
   F031580 with the sellable SKU (81995) carried as ?variationProductCode.

Networking is plain `requests` first (fast, and enough from a normal store
IP — it's what the user's original tool used). If Ace's bot protection
(Akamai) returns 403/blocks, it transparently falls back to driving the
Windows-preinstalled Microsoft Edge headless via Selenium to establish a
trusted session, then retries.

Every step is recorded in `diagnostics` so failures are debuggable.
"""
from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import requests

BASE = "https://www.acehardware.com"
SCRAPE_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass
class Diag:
    title: str
    detail: str
    ok: bool


@dataclass
class LookupResult:
    product_name: Optional[str] = None
    detail_line: Optional[str] = None
    price_text: Optional[str] = None
    was_price_text: Optional[str] = None
    image_bytes: Optional[bytes] = None
    image_url: Optional[str] = None
    product_url: Optional[str] = None
    resolved_item_number: Optional[str] = None
    price_candidates: List[Tuple[str, str]] = field(default_factory=list)  # (value, source)
    diagnostics: List[Diag] = field(default_factory=list)
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Small pure helpers (unit-tested)
# ---------------------------------------------------------------------------
def is_product_code(s: str) -> bool:
    """Ace item code: alphanumeric, 4–14 chars, >=4 digits (F031580, 8315087).
    Rejects word slugs (traeger, bird-food)."""
    if not s or not (4 <= len(s) <= 14):
        return False
    if not s.isalnum():
        return False
    return sum(c.isdigit() for c in s) >= 4


def looks_like_product_path(path: str) -> bool:
    if "/search" in path:
        return False
    if not (path.startswith("/departments/") or path.startswith("/p/")):
        return False
    last = path.rstrip("/").split("/")[-1]
    return is_product_code(last)


def clean_product_name(raw: str) -> str:
    s = re.sub(r"\s*[-|–—]\s*Ace Hardware.*$", "", raw, flags=re.I).strip()
    s = re.sub(r"\s*(?:Mfr|Manufacturer|Item|Model|SKU|Part|UPC)\.?\s*#?:?\s*[A-Za-z0-9._-]+\s*$",
               "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def choose_image_url(candidates: List[str]) -> Optional[str]:
    norm = []
    for raw in candidates:
        s = (raw or "").replace("\\/", "/").strip()
        if s.startswith("//"):
            s = "https:" + s
        if s.startswith("http://"):
            s = "https://" + s[len("http://"):]
        if not s.startswith("https://"):
            continue
        norm.append(s)

    def is_chrome(u: str) -> bool:
        low = u.lower()
        return any(k in low for k in
                   (".svg", "logo", "sprite", "icon", "badge", "placeholder",
                    "swatch", "spinner", "pixel", "flag"))

    product = [u for u in norm if not is_chrome(u)]
    pool = product or norm
    for u in pool:
        if "mozu.com" in u or "acehardware" in u:
            return u
    return pool[0] if pool else None


def api_product_image_url(content: dict) -> Optional[str]:
    """Primary photo from a Kibo `content` block: productImages in sequence
    order, first usable URL."""
    images = content.get("productImages")
    if not isinstance(images, list) or not images:
        return None

    def seq(d):
        v = d.get("sequence")
        return v if isinstance(v, (int, float)) else 9999

    urls = []
    for d in sorted(images, key=seq):
        if not isinstance(d, dict):
            continue
        u = d.get("imageUrl") or d.get("url") or d.get("cdnUrl")
        if u:
            urls.append(u)
    return choose_image_url(urls)


def store_price_queries(page_url: str, resolved_item: Optional[str],
                        typed_query: str) -> List[Tuple[str, Optional[str]]]:
    """Candidate (code, variation) pairs to try against the price API,
    most-specific first, de-duplicated."""
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(page_url)
    variation_param = parse_qs(parsed.query).get("variationProductCode", [None])[0]
    url_code = None
    if looks_like_product_path(parsed.path):
        url_code = parsed.path.rstrip("/").split("/")[-1]
    typed_is_code = is_product_code(typed_query)

    product_code = url_code or resolved_item
    variation = variation_param or (typed_query if typed_is_code else None)

    out: List[Tuple[str, Optional[str]]] = []

    def add(code, var):
        if not code or not is_product_code(code):
            return
        if var == code:
            var = None
        if (code, var) not in out:
            out.append((code, var))

    add(product_code, variation)
    add(product_code, None)
    add(variation, None)
    add(resolved_item, None)
    add(typed_query if typed_is_code else None, None)
    return out


# ---------------------------------------------------------------------------
# JSON-LD parsing (schema.org Product / ProductGroup)
# ---------------------------------------------------------------------------
def _jsonld_products(html: str) -> List[dict]:
    products = []
    for block in re.findall(
            r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
            html, re.I | re.S):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue

        def collect(node):
            if isinstance(node, dict):
                t = node.get("@type")
                types = t if isinstance(t, list) else [t]
                if any(isinstance(x, str) and x.lower() == "product" for x in types):
                    products.append(node)
                if "@graph" in node:
                    collect(node["@graph"])
                if "hasVariant" in node:
                    collect(node["hasVariant"])
            elif isinstance(node, list):
                for x in node:
                    collect(x)

        collect(data)
    return products


def _img_tag_sources(html: str) -> List[str]:
    urls = []
    for pat in (r'<img[^>]+(?:data-src|src)="([^"]+)"',
                r'<source[^>]+srcset="([^",\s]+)'):
        urls.extend(re.findall(pat, html, re.I))
    return urls


def _meta(html: str, key: str) -> Optional[str]:
    for pat in (rf'<meta[^>]+(?:property|name)="{re.escape(key)}"[^>]+content="([^"]+)"',
                rf'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="{re.escape(key)}"'):
        m = re.search(pat, html, re.I | re.S)
        if m:
            return m.group(1)
    return None


def _page_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return m.group(1).strip() if m else None


def _price_regex_fallback(html: str) -> List[float]:
    for pat in (r'itemprop="price"[^>]*content="([0-9]+(?:\.[0-9]{1,2})?)"',
                r'"price"\s*:\s*"?([0-9]+\.[0-9]{2})"?',
                r'class="[^"]*price[^"]*"[^>]*>\s*\$\s*([0-9]+\.[0-9]{2})'):
        vals = [float(x) for x in re.findall(pat, html, re.I)]
        if vals:
            return vals
    return []


# ---------------------------------------------------------------------------
# The lookup service
# ---------------------------------------------------------------------------
class AceLookup:
    def __init__(self):
        self._session: Optional[requests.Session] = None
        self._selenium_cookies_loaded = False

    # -- session management -------------------------------------------------
    def _get_session(self, force_refresh=False) -> requests.Session:
        if self._session is None or force_refresh:
            s = requests.Session()
            s.headers.update(SCRAPE_HEADERS)
            self._session = s
        return self._session

    def _get(self, url: str, diagnostics: List[Diag], timeout=20):
        """GET through requests; on a block, prime via Selenium+Edge and retry."""
        s = self._get_session()
        try:
            r = s.get(url, timeout=timeout, allow_redirects=True)
        except requests.RequestException as exc:
            diagnostics.append(Diag("Network error", f"{exc} ({url})", False))
            return None
        if r.status_code == 403 or _looks_blocked(r.text):
            diagnostics.append(Diag("Blocked by bot protection — using Edge",
                                    f"HTTP {r.status_code} for {url}; establishing a browser session.",
                                    False))
            if self._prime_with_selenium(diagnostics):
                try:
                    r = self._get_session().get(url, timeout=timeout, allow_redirects=True)
                except requests.RequestException as exc:
                    diagnostics.append(Diag("Network error after Edge prime", str(exc), False))
                    return None
        return r

    def _prime_with_selenium(self, diagnostics: List[Diag]) -> bool:
        """Drive headless Edge once to pass Akamai and copy its cookies into
        the requests session. Edge ships with Windows 10/11."""
        if self._selenium_cookies_loaded:
            return True
        try:
            from selenium import webdriver
            from selenium.webdriver.edge.options import Options
        except Exception as exc:  # selenium not installed
            diagnostics.append(Diag("Edge fallback unavailable",
                                    f"Selenium not available ({exc}). Install it or try again later.",
                                    False))
            return False
        driver = None
        try:
            opts = Options()
            opts.add_argument("--headless=new")
            opts.add_argument("--disable-gpu")
            opts.add_argument("--window-size=1280,900")
            opts.add_argument(f"--user-agent={SCRAPE_HEADERS['User-Agent']}")
            driver = webdriver.Edge(options=opts)
            driver.set_page_load_timeout(40)
            driver.get(f"{BASE}/product/8315087")
            # let the challenge scripts settle
            import time
            time.sleep(3)
            sess = self._get_session()
            for c in driver.get_cookies():
                sess.cookies.set(c["name"], c["value"], domain=c.get("domain"))
            self._selenium_cookies_loaded = True
            diagnostics.append(Diag("Browser session established (Edge)",
                                    "Cookies copied into the lookup session.", True))
            return True
        except Exception as exc:
            diagnostics.append(Diag("Edge fallback failed",
                                    f"{exc}. Make sure Microsoft Edge is installed.", False))
            return False
        finally:
            if driver is not None:
                try:
                    driver.quit()
                except Exception:
                    pass

    # -- main entry ---------------------------------------------------------
    def lookup(self, sku: str, store_code: str) -> LookupResult:
        out = LookupResult()
        query = (sku or "").strip()
        if not query:
            out.error = "Enter a SKU, item number, product name, or product URL."
            return out

        looks_numeric = query.isdigit() and len(query) >= 4
        product_html = None
        product_url = None

        # Route to a product page.
        if query.lower().startswith("http") and "acehardware.com" in query.lower():
            r = self._get(query, out.diagnostics)
            if r is not None and r.status_code == 200:
                product_html, product_url = r.text, r.url
                out.diagnostics.append(Diag("Pasted product URL opened", r.url, True))
            elif r is not None:
                out.error = _friendly(r.status_code)
        elif looks_numeric:
            r = self._get(f"{BASE}/product/{query}", out.diagnostics)
            if r is not None and r.status_code == 200 and (
                    looks_like_product_path(_path_of(r.url)) or _jsonld_products(r.text)):
                product_html, product_url = r.text, r.url
                out.diagnostics.append(
                    Diag("Product page opened directly by item number",
                         f"{BASE}/product/{query} → {r.url}", True))
            else:
                code = r.status_code if r is not None else "—"
                out.diagnostics.append(
                    Diag("Direct product URL wasn't a product page — trying search",
                         f"{BASE}/product/{query} (HTTP {code})", False))

        if product_html is None and not query.lower().startswith("http"):
            product_html, product_url = self._search(query, out, looks_numeric)

        if product_html is None:
            if out.error is None:
                out.error = (f'No product found for "{query}". Store shelf SKUs don\'t '
                             "always match the website's item numbers — try the product "
                             "name, or paste the acehardware.com product URL.")
            return out

        self._parse_product(product_html, product_url, query, out)
        self._apply_store_price(product_url, query, store_code, out)

        if out.image_url and out.image_bytes is None:
            out.image_bytes = self._download_image(out.image_url, out.diagnostics)
        return out

    # -- search fallback ----------------------------------------------------
    def _search(self, query: str, out: LookupResult, looks_numeric: bool = False):
        from urllib.parse import quote
        r = self._get(f"{BASE}/search?query={quote(query, safe='')}", out.diagnostics)
        if r is None or r.status_code != 200:
            if r is not None and out.error is None:
                out.error = _friendly(r.status_code)
            return None, None
        # A numeric SKU must match exactly — never substitute a different item.
        link = _first_product_link(r.text, query, require_exact_sku=looks_numeric)
        if not link:
            if looks_numeric:
                out.diagnostics.append(Diag(
                    f"No exact match for SKU {query} — refusing to substitute",
                    "Search returned other item numbers; showing one would put the wrong price on the sign.",
                    False))
                out.error = (f"acehardware.com has no item with SKU {query}. (Its search "
                             "suggested other item numbers, which were ignored so you don't "
                             "get the wrong product/price.) Double-check the SKU, search by "
                             "product name, or paste the product's acehardware.com URL.")
            else:
                out.diagnostics.append(Diag("No product links in search results",
                                            f'Nothing matched "{query}".', False))
                out.error = (f'acehardware.com found no product for "{query}". Try a different '
                             "product name, or paste the product URL.")
            return None, None
        url = link if link.startswith("http") else BASE + link
        r2 = self._get(url, out.diagnostics)
        if r2 is not None and r2.status_code == 200:
            out.diagnostics.append(Diag("Product page loaded", r2.url, True))
            return r2.text, r2.url
        return None, None

    # -- product page parsing ----------------------------------------------
    def _parse_product(self, html: str, page_url: str, sku: str, out: LookupResult):
        out.product_url = page_url
        image_candidates: List[str] = []
        raw_prices: List[float] = []

        products = _jsonld_products(html)
        if products:
            p = products[0]
            name = p.get("name")
            if isinstance(name, str):
                out.product_name = _unescape(name).strip()
            brand = p.get("brand")
            if isinstance(brand, dict):
                brand = brand.get("name")
            if isinstance(brand, str) and brand and brand != out.product_name:
                out.detail_line = brand
            img = p.get("image")
            if isinstance(img, str):
                image_candidates.append(img)
            elif isinstance(img, list):
                image_candidates.extend(x for x in img if isinstance(x, str))
            ld_sku = p.get("sku") or p.get("mpn")
            if isinstance(ld_sku, (str, int)):
                out.resolved_item_number = str(ld_sku)
            out.diagnostics.append(Diag("Structured product data (JSON-LD) parsed",
                                        f"name: {out.product_name or '—'}", True))
        else:
            out.diagnostics.append(Diag("No JSON-LD product block on the page",
                                        "Falling back to title and rendered image tags.", False))

        is_product = bool(products) or looks_like_product_path(_path_of(page_url))

        if not out.product_name:
            title = _meta(html, "og:title") or _page_title(html)
            if title:
                out.product_name = clean_product_name(_unescape(title))
                out.diagnostics.append(Diag("Product name taken from page title",
                                            out.product_name, True))

        if is_product:
            og = _meta(html, "og:image")
            if og:
                image_candidates.append(og)
            image_candidates.extend(_img_tag_sources(html))
            raw_prices.extend(_price_regex_fallback(html))

        if out.resolved_item_number is None and looks_like_product_path(_path_of(page_url)):
            out.resolved_item_number = _path_of(page_url).rstrip("/").split("/")[-1]

        # page price (fallback; store API overrides below)
        good = [v for v in raw_prices if 0 < v < 100000]
        if good:
            out.price_text = "%.2f" % good[0]
            seen = set()
            for v in good[:5]:
                val = "%.2f" % v
                if val not in seen:
                    seen.add(val)
                    out.price_candidates.append((val, "page HTML"))
            out.diagnostics.append(Diag(f"Price selected: ${out.price_text}",
                                        f"{len(good)} candidate(s) from page HTML", True))

        img = choose_image_url(image_candidates)
        if img:
            out.image_url = img
            out.diagnostics.append(Diag("Photo URL selected (page)",
                                        f"{img} (of {len(image_candidates)} candidates)", True))

    # -- store-specific price + authoritative name/photo -------------------
    def _apply_store_price(self, page_url, query, store_code, out: LookupResult):
        from urllib.parse import urlencode
        queries = store_price_queries(page_url or "", out.resolved_item_number, query)
        applied = False
        for code, variation in queries:
            params = {"purchaseLocation": store_code}
            if variation:
                params["variationProductCode"] = variation
            api = f"{BASE}/api/commerce/catalog/storefront/products/{code}?{urlencode(params)}"
            r = self._get(api, out.diagnostics, timeout=20)
            if r is None or r.status_code != 200:
                continue
            try:
                root = r.json()
            except ValueError:
                continue
            if self._consume_store_json(root, store_code, out):
                applied = True
                break
        if not applied:
            out.diagnostics.append(Diag("Store-specific price unavailable — kept page price",
                                        "Verify the price on the product page.", False))

    def _consume_store_json(self, root: dict, store_code: str, out: LookupResult) -> bool:
        if not isinstance(root, dict):
            return False
        price_obj = root.get("price") if isinstance(root.get("price"), dict) else root.get("priceInfo")
        regular = _num(price_obj.get("price")) if isinstance(price_obj, dict) else None
        sale = _num(price_obj.get("salePrice")) if isinstance(price_obj, dict) else None
        current = sale if sale is not None else regular
        if current is None:
            return False
        was = regular if (sale is not None and regular is not None and regular > sale + 0.005) else None

        out.price_text = "%.2f" % current
        out.was_price_text = ("%.2f" % was) if was is not None else None
        out.price_candidates.insert(0, ("%.2f" % current, f"Store #{store_code}"))
        reg_note = f" (reg ${'%.2f' % was})" if was is not None else ""
        out.diagnostics.append(Diag(f"Store price applied: ${'%.2f' % current}{reg_note}",
                                    f"Store-specific price for #{store_code} — overrides page price.", True))

        content = root.get("content") if isinstance(root.get("content"), dict) else root
        if (not out.product_name) and isinstance(content, dict):
            name = content.get("productName") or content.get("productShortName")
            if isinstance(name, str) and name.strip():
                out.product_name = _unescape(name).strip()
        if isinstance(content, dict):
            api_img = api_product_image_url(content)
            if api_img:
                out.image_url = api_img
                out.image_bytes = None  # force re-download of the authoritative image
                out.diagnostics.append(Diag("Photo taken from the store API (authoritative)",
                                            api_img, True))
        return True

    # -- image download -----------------------------------------------------
    def _download_image(self, url: str, diagnostics: List[Diag]) -> Optional[bytes]:
        # Ace's CDN serves the original when the ?max= thumbnail param is dropped;
        # request a print-quality size otherwise.
        attempts = []
        if "?" in url:
            attempts.append(url.split("?")[0])
        attempts.append(url if "?" in url else url + "?max=1000")
        attempts.append(url)
        for attempt in attempts:
            try:
                r = self._get_session().get(attempt, timeout=20)
                if r.status_code == 200 and r.content and len(r.content) > 200:
                    diagnostics.append(Diag("Photo downloaded", attempt, True))
                    return r.content
            except requests.RequestException:
                continue
        diagnostics.append(Diag("Photo download failed", url, False))
        return None


# ---------------------------------------------------------------------------
# module helpers
# ---------------------------------------------------------------------------
def _first_product_link(html: str, sku: str, require_exact_sku: bool = False) -> Optional[str]:
    """Best product link in a search page. When require_exact_sku is True (the
    query is a shelf SKU / item number), only a link whose item number IS that
    SKU is accepted — search must never substitute a different product, or the
    sign gets the wrong item and price. Returns None if there's no exact match."""
    normalized = html.replace("\\/", "/")
    links = []
    for pat in (r'href="((?:https://www\.acehardware\.com)?(?:/departments/|/p/)[^"#?]+)',
                r'"(?:productUrl|seoUrl|url|productSeoUrl)"\s*:\s*"((?:https://www\.acehardware\.com)?(?:/departments/|/p/)[^"#?]+)"'):
        for link in re.findall(pat, normalized, re.I):
            last = link.rstrip("/").split("/")[-1]
            if is_product_code(last) and link not in links:
                links.append(link)
    if not links:
        return None
    for link in links:
        if link.endswith("/" + sku):
            return link
    if require_exact_sku:
        return None
    for link in links:
        if sku in link:
            return link
    return links[0]


def _looks_blocked(text: str) -> bool:
    if not text or len(text) > 4000:
        return False
    low = text.lower()
    return any(k in low for k in ("access denied", "pardon our interruption",
                                  "cp_challenge", "captcha"))


def _path_of(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url or "").path


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace("$", "").replace(",", ""))
        except ValueError:
            return None
    return None


def _unescape(s: str) -> str:
    import html as html_mod
    return html_mod.unescape(s)


def _friendly(status) -> str:
    if status == 403:
        return ("acehardware.com is blocking lookups from this connection (HTTP 403). "
                "Wait a minute and try again; the app will use Microsoft Edge to establish "
                "a trusted session.")
    return f"Lookup failed (HTTP {status})."
