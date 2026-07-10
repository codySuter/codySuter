import Foundation
import AppKit

struct LookupOutcome {
    var productName: String?
    var detailLine: String?
    var priceText: String?
    var wasPriceText: String?
    var imageURL: URL?
    var productPageURL: URL?
    /// The website's item number for the product, when the page reveals it.
    var resolvedItemNumber: String?
    var priceCandidates: [PriceCandidate] = []
    var diagnostics: [DiagnosticEntry] = []
    var errorSummary: String?
}

struct LookupError: Error {
    let message: String
}

/// Looks up a SKU on acehardware.com: establishes store context for the
/// configured store number, resolves the SKU to a product page through the
/// site's search, then extracts name / price / photo from several redundant
/// places in the page (JSON-LD, embedded JSON state, meta tags, raw HTML).
/// Pages load through an embedded WebKit view (WebPageFetcher) so the site's
/// bot protection passes as it does for a normal visitor.
/// Everything it does is recorded as diagnostics so failures are debuggable.
final class AceLookupService {
    private let session: URLSession   // image downloads only; pages go through WebKit
    private var visitedStoreCode: String?
    private var pageFetcher: WebPageFetcher?

    static let base = "https://www.acehardware.com"
    static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 60
        config.httpAdditionalHeaders = [
            "User-Agent": Self.userAgent,
            "Accept": "image/avif,image/webp,image/png,image/*;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        ]
        session = URLSession(configuration: config)
    }

    @MainActor
    private func fetcher() -> WebPageFetcher {
        if let existing = pageFetcher { return existing }
        let created = WebPageFetcher()
        pageFetcher = created
        return created
    }

    // MARK: Readiness probes (JS run inside the embedded browser)

    /// True once the search page has rendered at least one link ending in an
    /// item code (all digits, or letter-prefixed alphanumeric with ≥4 digits)
    /// — i.e. an actual product tile, not a nav/category link.
    private static let searchResultsProbe = """
    (function () {
      var anchors = document.querySelectorAll('a[href]');
      for (var i = 0; i < anchors.length; i++) {
        var path = (anchors[i].getAttribute('href') || '').split('?')[0].split('#')[0];
        if (!/\\/(departments|p)\\//.test(path)) { continue; }
        var seg = path.split('/').pop();
        if (/^[A-Za-z0-9]+$/.test(seg) && (seg.match(/\\d/g) || []).length >= 4) { return true; }
      }
      return false;
    })()
    """

    /// True once a product page has meaningful content (structured data or a
    /// rendered heading).
    private static let productPageProbe = """
    (function () {
      if (document.querySelector('script[type="application/ld+json"]')) { return true; }
      var h1 = document.querySelector('h1');
      return !!(h1 && h1.textContent && h1.textContent.trim().length > 0);
    })()
    """

    // MARK: Main entry point

    func lookup(sku: String, storeCode: String) async -> LookupOutcome {
        var out = LookupOutcome()
        let query = sku.trimmingCharacters(in: .whitespacesAndNewlines)

        // Step 1 — visit the store page so the session carries the local
        // store context (cookies) before we ask for a product.
        if visitedStoreCode != storeCode {
            let storeURL = URL(string: "\(Self.base)/store-details/\(storeCode)")!
            switch await fetchPage(storeURL) {
            case .success(let page):
                visitedStoreCode = storeCode
                out.diagnostics.append(DiagnosticEntry(
                    title: "Store context loaded (store #\(storeCode))",
                    detail: "\(page.finalURL.absoluteString) — via embedded Safari engine", ok: true))
            case .failure(let error):
                out.diagnostics.append(DiagnosticEntry(
                    title: "Store page request failed",
                    detail: error.message, ok: false))
            }
        }

        var productHTML: String?
        var productURL: URL?

        // Step 2 — reach a product page. Three routes, in order of directness:
        //   (a) a pasted acehardware.com URL,
        //   (b) the direct product URL /product/{sku} when the query is an
        //       item number — no search, so no chance of matching the wrong
        //       tile (this is how the standalone tool did it),
        //   (c) site search, for names or shelf SKUs that aren't web item #s.
        let looksNumeric = query.count >= 4 && query.allSatisfy(\.isNumber)

        if query.lowercased().hasPrefix("http"),
           let directURL = URL(string: query),
           directURL.host?.lowercased().contains("acehardware.com") == true {
            switch await fetchPage(directURL, probe: Self.productPageProbe) {
            case .success(let page):
                productHTML = page.html
                productURL = page.finalURL
                out.diagnostics.append(DiagnosticEntry(
                    title: "Pasted product URL opened directly",
                    detail: page.finalURL.absoluteString, ok: true))
            case .failure(let error):
                out.diagnostics.append(DiagnosticEntry(
                    title: "Pasted URL failed to load",
                    detail: error.message, ok: false))
                out.errorSummary = Self.friendlyMessage(for: error)
            }
        } else if looksNumeric, let directURL = URL(string: "\(Self.base)/product/\(query)") {
            switch await fetchPage(directURL, probe: Self.productPageProbe) {
            case .success(let page):
                if Self.looksLikeProductPath(page.finalURL.path, sku: query)
                    || !HTMLParsers.jsonLDProducts(in: page.html).isEmpty {
                    productHTML = page.html
                    productURL = page.finalURL
                    out.diagnostics.append(DiagnosticEntry(
                        title: "Product page opened directly by item number",
                        detail: "\(Self.base)/product/\(query) → \(page.finalURL.absoluteString)", ok: true))
                } else {
                    // Not a product page (redirected to search/home) — search handles it.
                    out.diagnostics.append(DiagnosticEntry(
                        title: "Direct product URL wasn't a product page — trying search",
                        detail: "\(Self.base)/product/\(query) → \(page.finalURL.absoluteString)", ok: false))
                }
            case .failure(let error):
                out.diagnostics.append(DiagnosticEntry(
                    title: "Direct product URL failed to load — trying search",
                    detail: error.message, ok: false))
            }
        }

        if productHTML == nil, !query.lowercased().hasPrefix("http") {
            // Encode strictly (RFC 3986 unreserved only) so '&', '+', '=' in
            // product-name searches survive as literal characters.
            let unreserved = CharacterSet(charactersIn:
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
            let encoded = query.addingPercentEncoding(withAllowedCharacters: unreserved) ?? query
            guard let searchURL = URL(string: "\(Self.base)/search?query=\(encoded)") else {
                out.errorSummary = "That doesn't look like a SKU or URL the site can search for."
                return out
            }

            switch await fetchPage(searchURL, probe: Self.searchResultsProbe) {
            case .success(let page):
                if Self.looksLikeProductPath(page.finalURL.path, sku: query) {
                    productHTML = page.html
                    productURL = page.finalURL
                    out.diagnostics.append(DiagnosticEntry(
                        title: "Search redirected straight to the product page",
                        detail: page.finalURL.absoluteString, ok: true))
                } else {
                    out.diagnostics.append(DiagnosticEntry(
                        title: "Search results page received",
                        detail: "\(page.html.count) bytes from \(page.finalURL.absoluteString)", ok: true))
                    if let link = HTMLParsers.firstProductLink(in: page.html, sku: query) {
                        let absolute = link.hasPrefix("http") ? link : Self.base + link
                        if let linkURL = URL(string: absolute) {
                            switch await fetchPage(linkURL, probe: Self.productPageProbe) {
                            case .success(let productPage):
                                productHTML = productPage.html
                                productURL = productPage.finalURL
                                out.diagnostics.append(DiagnosticEntry(
                                    title: "Product page loaded",
                                    detail: productPage.finalURL.absoluteString, ok: true))
                            case .failure(let error):
                                out.diagnostics.append(DiagnosticEntry(
                                    title: "Product page request failed",
                                    detail: error.message, ok: false))
                                out.errorSummary = Self.friendlyMessage(for: error)
                            }
                        }
                    } else {
                        out.diagnostics.append(DiagnosticEntry(
                            title: "No product links in the search results",
                            detail: "Only links ending in a numeric item number count as products; none appeared for \"\(query)\" (nav and category links are ignored).",
                            ok: false))
                        out.errorSummary = "acehardware.com's search found no product for \"\(query)\". Store shelf SKUs don't always match the website's item numbers — try searching the product's name instead (e.g. \"wild bird food 40 lb\"), or open the product in Safari and paste its URL into the SKU box."
                    }
                }
            case .failure(let error):
                out.diagnostics.append(DiagnosticEntry(
                    title: "Search request failed",
                    detail: error.message, ok: false))
                out.errorSummary = Self.friendlyMessage(for: error)
            }
        }

        // Step 3 — extract product data from the page.
        if let html = productHTML, let url = productURL {
            parseProduct(html: html, pageURL: url, sku: query, into: &out)

            // Step 4 — overlay the store-specific price from the storefront
            // JSON API (purchaseLocation = the store). Runs in the same
            // WebKit session, so it carries the Mozu auth cookies and the
            // Akamai clearance the page load already earned. This is the
            // authoritative price for the store; it wins over whatever was
            // scraped from the page.
            //
            // Ace pages a product like the bird seed as F031580 with the
            // sellable SKU (81995) as ?variationProductCode. We don't know
            // which code the price API keys on, so try, in order: the product
            // code with the variation, the product code alone, and the bare
            // SKU — first one that returns a price wins.
            let queries = Self.storePriceQueries(pageURL: url,
                                                 resolvedItemNumber: out.resolvedItemNumber,
                                                 typedQuery: query)
            var applied = false
            for q in queries {
                guard let apiURL = Self.storePriceAPIURL(code: q.code, variation: q.variation, storeCode: storeCode) else { continue }
                // Await the network here (no inout held across the suspension),
                // then apply synchronously.
                let jsonText = await fetchJSONText(apiURL)
                if applyStorePrice(jsonText: jsonText, apiURL: apiURL, storeCode: storeCode, into: &out) {
                    applied = true
                    break
                }
            }
            if !applied {
                out.diagnostics.append(DiagnosticEntry(
                    title: "Store-specific price unavailable — kept the page price",
                    detail: "Tried item code(s): \(queries.map(\.label).joined(separator: ", ")). The price shown is from the product page; confirm it via Open Product Page.",
                    ok: false))
            }
        } else if out.errorSummary == nil {
            out.errorSummary = "Couldn't find a product for \"\(query)\" on acehardware.com. Double-check the SKU, search by product name, or fill the sign in manually."
        }
        return out
    }

    // MARK: Store-specific price (Kibo/Mozu storefront API)

    struct StoreQuery {
        let code: String
        let variation: String?
        var label: String { variation.map { "\(code)+\($0)" } ?? code }
    }

    /// Candidate (product code, variation) pairs to try against the price API,
    /// most-specific first. De-duplicated, order preserved.
    static func storePriceQueries(pageURL: URL, resolvedItemNumber: String?, typedQuery: String) -> [StoreQuery] {
        let comps = URLComponents(url: pageURL, resolvingAgainstBaseURL: false)
        let variationParam = comps?.queryItems?.first { $0.name == "variationProductCode" }?.value
        let urlCode = looksLikeProductPath(pageURL.path, sku: typedQuery)
            ? pageURL.path.split(separator: "/").last.map(String.init) : nil
        let typedIsCode = isProductCode(typedQuery)

        // The product/group code (F031580): from the URL, else the resolved item number.
        let productCode = urlCode ?? resolvedItemNumber
        // The sellable variation SKU (81995): the URL param, else the typed SKU.
        let variation = variationParam ?? (typedIsCode ? typedQuery : nil)

        var out: [StoreQuery] = []
        func add(_ code: String?, _ variation: String?) {
            guard let code, isProductCode(code) else { return }
            let q = StoreQuery(code: code, variation: variation.flatMap { $0 == code ? nil : $0 })
            if !out.contains(where: { $0.code == q.code && $0.variation == q.variation }) { out.append(q) }
        }
        add(productCode, variation)   // F031580 + variationProductCode=81995
        add(productCode, nil)         // F031580 alone
        add(variation, nil)           // 81995 as a product code
        add(resolvedItemNumber, nil)  // whatever JSON-LD reported
        add(typedIsCode ? typedQuery : nil, nil)
        return out
    }

    static func storePriceAPIURL(code: String, variation: String?, storeCode: String) -> URL? {
        var comps = URLComponents(string: "\(base)/api/commerce/catalog/storefront/products/\(code)")
        var items = [URLQueryItem(name: "purchaseLocation", value: storeCode)]
        if let variation { items.append(URLQueryItem(name: "variationProductCode", value: variation)) }
        comps?.queryItems = items
        return comps?.url
    }

    /// Parses one storefront API response. On a usable price, sets the sign's
    /// price (regular becomes the strikethrough was-price when on sale) and
    /// returns true. Returns false without logging so the caller can try the
    /// next candidate code quietly. Synchronous — the `inout` never spans an
    /// `await`.
    @discardableResult
    private func applyStorePrice(jsonText: String?, apiURL: URL, storeCode: String, into out: inout LookupOutcome) -> Bool {
        guard let text = jsonText,
              let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }

        // Kibo shape: { "price": { "price": <regular>, "salePrice": <sale?> }, "content": { "productName": ... } }
        let priceObj = (root["price"] as? [String: Any])
            ?? (root["priceInfo"] as? [String: Any])
        let regular = priceObj.flatMap { JSONScanner.doubleValue($0["price"] as Any) }
        let sale = priceObj.flatMap { JSONScanner.doubleValue($0["salePrice"] as Any) }

        guard let current = sale ?? regular else { return false }
        let was: Double? = (sale != nil && regular != nil && regular! > sale! + 0.005) ? regular : nil

        out.priceText = String(format: "%.2f", current)
        out.wasPriceText = was.map { String(format: "%.2f", $0) }
        let candidate = PriceCandidate(value: String(format: "%.2f", current), source: "Store #\(storeCode)")
        out.priceCandidates.removeAll { $0.value == candidate.value }
        out.priceCandidates.insert(candidate, at: 0)
        let regNote = was.map { " (reg $\(String(format: "%.2f", $0)))" } ?? ""
        out.diagnostics.append(DiagnosticEntry(
            title: "Store price applied: $\(String(format: "%.2f", current))\(regNote)",
            detail: "Store-specific price for #\(storeCode) from the storefront API — overrides the page price.", ok: true))
        return true
    }

    /// Loads a JSON endpoint through the WebKit session and returns the
    /// response body text. WebKit renders a JSON document as text we can read.
    @MainActor
    private func fetchJSONText(_ url: URL) async -> String? {
        do {
            let page = try await fetcher().fetch(
                url,
                readinessProbe: "(function(){var t=(document.body?document.body.innerText:'')||'';return t.indexOf('{')>-1||t.indexOf('[')>-1;})()",
                contentScript: WebPageFetcher.bodyTextExtractor,
                minContentLength: 2
            )
            guard page.status < 400 else { return nil }
            return page.html   // body innerText, per the extractor above
        } catch {
            return nil
        }
    }

    // MARK: Product page parsing

    private func parseProduct(html: String, pageURL: URL, sku: String, into out: inout LookupOutcome) {
        out.productPageURL = pageURL

        var rawPrices: [RawPrice] = []
        var imageCandidates: [String] = []

        // -- JSON-LD (schema.org Product) — most stable source for name/photo.
        let ldProducts = HTMLParsers.jsonLDProducts(in: html)
        if let product = ldProducts.first {
            if let name = product["name"] as? String {
                out.productName = HTMLParsers.decodeEntities(name).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            out.detailLine = Self.detailLine(fromJSONLD: product, excluding: out.productName)

            for url in Self.jsonLDImageURLs(product) {
                imageCandidates.append(url)
            }
            for price in Self.jsonLDPrices(product) {
                rawPrices.append(RawPrice(key: "json-ld", path: "json-ld.offers", value: price))
            }
            let ldSKU = (product["sku"] as? String)
                ?? (product["sku"] as? Int).map(String.init)
                ?? (product["mpn"] as? String)
            if let ldSKU, !ldSKU.isEmpty {
                out.resolvedItemNumber = ldSKU
                if !ldSKU.contains(sku), !sku.contains(ldSKU) {
                    out.diagnostics.append(DiagnosticEntry(
                        title: "Note: the site's item number differs from what you typed",
                        detail: "Page reports item \(ldSKU), you entered \(sku). Shelf SKUs and web item numbers don't always match — verify this is the right product via Open Product Page.",
                        ok: false))
                }
            }
            out.diagnostics.append(DiagnosticEntry(
                title: "Structured product data (JSON-LD) parsed",
                detail: "name: \(out.productName ?? "—"), prices: \(Self.jsonLDPrices(product).count), images: \(Self.jsonLDImageURLs(product).count)",
                ok: true))
        } else {
            out.diagnostics.append(DiagnosticEntry(
                title: "No JSON-LD product block on the page",
                detail: "Falling back to embedded JSON and meta tags.", ok: false))
        }

        // Anything price/image-shaped is only trustworthy on an actual
        // product page; on category/brand/search pages it belongs to other
        // products (that's how a Traeger grill priced a bag of bird seed).
        let isProductPage = !ldProducts.isEmpty || Self.looksLikeProductPath(pageURL.path, sku: sku)

        // -- Embedded JSON app state (Next.js data, window.__STATE__, Kibo preload…)
        if isProductPage {
            let blobs = HTMLParsers.embeddedJSONBlobs(in: html)
            var scanned: [(path: String, key: String, value: Double)] = []
            var scannedImages: [String] = []
            for blob in blobs {
                JSONScanner.priceFields(in: blob, into: &scanned)
                JSONScanner.imageURLs(in: blob, into: &scannedImages)
            }
            for hit in scanned {
                rawPrices.append(RawPrice(key: hit.key, path: hit.path, value: hit.value))
            }
            imageCandidates.append(contentsOf: scannedImages)
            out.diagnostics.append(DiagnosticEntry(
                title: "Embedded JSON scanned",
                detail: "\(blobs.count) JSON blobs, \(scanned.count) price fields, \(scannedImages.count) image URLs",
                ok: !blobs.isEmpty))
        } else {
            out.diagnostics.append(DiagnosticEntry(
                title: "Not a product page — price and photo extraction skipped",
                detail: "\(pageURL.path) looks like a category, brand, or other non-product page. Open the specific product and paste its URL.",
                ok: false))
        }

        // -- Meta tag fallbacks.
        if out.productName == nil || out.productName!.isEmpty {
            if let title = HTMLParsers.metaContent(propertyOrName: "og:title", in: html) ?? HTMLParsers.pageTitle(in: html) {
                out.productName = Self.stripSiteSuffix(HTMLParsers.decodeEntities(title))
                out.diagnostics.append(DiagnosticEntry(
                    title: "Product name taken from page title", detail: out.productName ?? "", ok: true))
            }
        }
        if isProductPage, let ogImage = HTMLParsers.metaContent(propertyOrName: "og:image", in: html) {
            imageCandidates.append(ogImage)
        }

        // -- Raw-HTML price patterns as a last resort, product pages only.
        if isProductPage {
            for value in HTMLParsers.priceRegexFallback(in: html) {
                rawPrices.append(RawPrice(key: "price", path: "html", value: value))
            }
        }

        // The page's own item number, from the URL if JSON-LD didn't say.
        // Product paths only — a pasted store-details or category URL must
        // not donate its trailing number (e.g. the store code) as a SKU.
        if out.resolvedItemNumber == nil,
           Self.looksLikeProductPath(pageURL.path, sku: sku),
           let last = pageURL.path.split(separator: "/").last {
            out.resolvedItemNumber = String(last)
        }

        // -- Choose the price.
        let chosen = Self.choosePrices(from: rawPrices)
        out.priceText = chosen.price.map { String(format: "%.2f", $0) }
        out.wasPriceText = chosen.wasPrice.map { String(format: "%.2f", $0) }
        out.priceCandidates = chosen.candidates
        if let priceText = out.priceText {
            out.diagnostics.append(DiagnosticEntry(
                title: "Price selected: $\(priceText)",
                detail: "from \(chosen.chosenSource ?? "?") — \(chosen.candidates.count) distinct candidate(s) found",
                ok: true))
        } else {
            out.diagnostics.append(DiagnosticEntry(
                title: "No price found on the page",
                detail: "Enter the price manually. If this keeps happening, copy these diagnostics and share them so the parser can be updated.",
                ok: false))
        }

        // -- Choose the photo.
        if let imageURL = Self.chooseImageURL(from: imageCandidates) {
            out.imageURL = imageURL
            out.diagnostics.append(DiagnosticEntry(
                title: "Photo URL selected",
                detail: imageURL.absoluteString + " (of \(imageCandidates.count) candidates)", ok: true))
        } else {
            out.diagnostics.append(DiagnosticEntry(
                title: "No photo URL found",
                detail: "You can paste or drop a photo onto the sign instead.", ok: false))
        }
    }

    // MARK: Price selection

    struct RawPrice {
        let key: String    // lowercased JSON key or synthetic source
        let path: String   // where in the document it came from
        let value: Double
    }

    private static let wasPriceKeys: Set<String> = [
        "wasprice", "listprice", "regularprice", "msrp", "strikethroughprice", "originalprice", "comparableprice",
    ]

    static func choosePrices(from raw: [RawPrice])
        -> (price: Double?, wasPrice: Double?, candidates: [PriceCandidate], chosenSource: String?)
    {
        let sane = raw.filter { $0.value > 0 && $0.value < 100_000 }
        let current = sane.filter { !wasPriceKeys.contains($0.key) }
        let was = sane.filter { wasPriceKeys.contains($0.key) }

        func score(_ p: RawPrice) -> Int {
            var s: Int
            if p.key.contains("store") || p.key.contains("instore") || p.key.contains("pickup") {
                s = 0
            } else if p.key == "json-ld" {
                s = 1
            } else if p.key.contains("sale") || p.key.contains("final") || p.key.contains("current")
                || p.key.contains("promo") || p.key.contains("your") {
                s = 2
            } else if p.key == "price" {
                s = 3
            } else {
                s = 4
            }
            let lp = p.path.lowercased()
            for noise in ["recommend", "related", "carousel", "recent", "sponsored", "crosssell", "alsobought"] {
                if lp.contains(noise) { s += 20; break }
            }
            return s
        }

        let sortedCurrent = current.sorted { score($0) < score($1) }
        let best = sortedCurrent.first

        var candidates: [PriceCandidate] = []
        var seenValues = Set<String>()
        for p in sortedCurrent {
            let value = String(format: "%.2f", p.value)
            guard seenValues.insert(value).inserted else { continue }
            candidates.append(PriceCandidate(value: value, source: shortSource(p)))
            if candidates.count >= 5 { break }
        }

        var wasPrice: Double?
        if let bestPrice = best?.value {
            let higher = was.map(\.value).filter { $0 > bestPrice + 0.005 }
            wasPrice = higher.min() // the closest "regular" price above the sale price
        }
        return (best?.value, wasPrice, candidates, best.map(shortSource))
    }

    private static func shortSource(_ p: RawPrice) -> String {
        if p.key == "json-ld" { return "JSON-LD" }
        if p.path == "html" { return "page HTML" }
        let parts = p.path.split(separator: ".")
        return parts.suffix(2).joined(separator: ".")
    }

    // MARK: JSON-LD helpers

    private static func jsonLDPrices(_ product: [String: Any]) -> [Double] {
        var prices: [Double] = []
        func extract(fromOffer offer: [String: Any]) {
            for key in ["price", "lowPrice", "highPrice"] {
                if let value = JSONScanner.doubleValue(offer[key] as Any) {
                    prices.append(value)
                }
            }
        }
        if let offer = product["offers"] as? [String: Any] {
            extract(fromOffer: offer)
            if let inner = offer["offers"] as? [[String: Any]] {
                inner.forEach(extract(fromOffer:))
            }
        } else if let offers = product["offers"] as? [[String: Any]] {
            offers.forEach(extract(fromOffer:))
        }
        return prices
    }

    private static func jsonLDImageURLs(_ product: [String: Any]) -> [String] {
        var urls: [String] = []
        func add(_ any: Any?) {
            if let s = any as? String { urls.append(s) }
            else if let arr = any as? [Any] { arr.forEach { add($0) } }
            else if let dict = any as? [String: Any] { add(dict["url"] ?? dict["contentUrl"]) }
        }
        add(product["image"])
        return urls
    }

    private static func detailLine(fromJSONLD product: [String: Any], excluding name: String?) -> String? {
        var parts: [String] = []
        if let brand = product["brand"] as? String {
            parts.append(brand)
        } else if let brand = product["brand"] as? [String: Any], let brandName = brand["name"] as? String {
            parts.append(brandName)
        }
        if let model = (product["model"] as? String) ?? (product["mpn"] as? String), !model.isEmpty {
            parts.append("Model \(model)")
        }
        let line = parts.joined(separator: " • ")
        guard !line.isEmpty, line != name else { return nil }
        return HTMLParsers.decodeEntities(line)
    }

    private static func stripSiteSuffix(_ title: String) -> String {
        title.replacingOccurrences(
            of: "\\s*[-|–—]\\s*Ace Hardware.*$",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        ).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Image selection / download

    static func chooseImageURL(from candidates: [String]) -> URL? {
        var normalized: [String] = []
        for raw in candidates {
            var s = HTMLParsers.decodeEntities(raw)
                .replacingOccurrences(of: "\\/", with: "/")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if s.hasPrefix("//") { s = "https:" + s }
            if s.hasPrefix("http://") { s = "https://" + s.dropFirst("http://".count) }
            guard s.hasPrefix("https://") else { continue }
            normalized.append(s)
        }
        // Prefer Ace/Kibo CDN images, then anything that looks like a product shot.
        let preferred = normalized.first {
            $0.contains("mozu.com") || $0.contains("acehardware")
        }
        let pick = preferred ?? normalized.first
        return pick.flatMap { URL(string: $0) }
    }

    func fetchImage(from url: URL) async -> NSImage? {
        // Try without query parameters first — Ace's CDN serves thumbnails via
        // "?max=250"-style params, and dropping them returns the original.
        var stripped = URLComponents(url: url, resolvingAgainstBaseURL: false)
        stripped?.query = nil
        var attempts: [URL] = []
        if let clean = stripped?.url, clean != url { attempts.append(clean) }
        attempts.append(url)

        for attempt in attempts {
            if case .success(let fetched) = await fetchData(attempt),
               let image = NSImage(data: fetched.data),
               image.size.width > 10, image.size.height > 10 {
                return image
            }
        }
        return nil
    }

    // MARK: HTTP plumbing

    private struct FetchedPage {
        let html: String
        let finalURL: URL
    }

    /// Loads a page through the embedded WebKit engine. HTTP-level denials
    /// (403 etc.) become failures so callers surface them in diagnostics.
    private func fetchPage(_ url: URL, probe: String? = nil) async -> Result<FetchedPage, LookupError> {
        do {
            let page = try await fetcher().fetch(url, readinessProbe: probe)
            if page.status >= 400 {
                return .failure(LookupError(message: "HTTP \(page.status) for \(url.absoluteString) (embedded browser)"))
            }
            return .success(FetchedPage(html: page.html, finalURL: page.finalURL))
        } catch let error as LookupError {
            return .failure(error)
        } catch {
            return .failure(LookupError(message: "\(error.localizedDescription) (\(url.absoluteString))"))
        }
    }

    private func fetchData(_ url: URL) async -> Result<(data: Data, finalURL: URL), LookupError> {
        var request = URLRequest(url: url)
        request.setValue("\(Self.base)/", forHTTPHeaderField: "Referer")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(LookupError(message: "No HTTP response from \(url.absoluteString)"))
            }
            guard (200..<300).contains(http.statusCode) else {
                return .failure(LookupError(message: "HTTP \(http.statusCode) for \(url.absoluteString)"))
            }
            return .success((data: data, finalURL: http.url ?? url))
        } catch {
            return .failure(LookupError(message: "\(error.localizedDescription) (\(url.absoluteString))"))
        }
    }

    /// Product pages end in an item code: all digits (8043442) or a short
    /// letter-prefixed alphanumeric (F031580). Category and brand pages
    /// (/departments/outdoor-living/traeger, .../bird-food) end in a word
    /// slug and must never be treated as products.
    static func looksLikeProductPath(_ path: String, sku: String) -> Bool {
        if path.contains("/search") { return false }
        guard path.hasPrefix("/departments/") || path.hasPrefix("/p/"),
              let last = path.split(separator: "/").last
        else { return false }
        return isProductCode(String(last))
    }

    /// An Ace item code: alphanumeric (no hyphens/dots), 4–14 chars, with at
    /// least four digits. Matches "F031580" and "8315087"; rejects word slugs
    /// like "traeger", "bird-food", "outdoor-living".
    static func isProductCode(_ s: String) -> Bool {
        guard (4...14).contains(s.count),
              s.allSatisfy({ $0.isLetter || $0.isNumber })
        else { return false }
        return s.filter(\.isNumber).count >= 4
    }

    private static func friendlyMessage(for error: LookupError) -> String {
        let msg = error.message
        if msg.contains("HTTP 403") {
            return "acehardware.com is blocking lookups from this connection right now (HTTP 403), even through the app's embedded Safari engine. Wait a few minutes and try again; if it keeps up, open Diagnostics and share the log."
        }
        if msg.contains("timed out") || msg.contains("The request timed out") {
            return "The request timed out — check the internet connection and try again."
        }
        if msg.contains("offline") || msg.contains("not connected") {
            return "No internet connection."
        }
        return "Lookup failed: \(msg)"
    }
}
