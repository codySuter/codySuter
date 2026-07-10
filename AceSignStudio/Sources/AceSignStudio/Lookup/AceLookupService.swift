import Foundation
import AppKit

struct LookupOutcome {
    var productName: String?
    var detailLine: String?
    var priceText: String?
    var wasPriceText: String?
    var imageURL: URL?
    var productPageURL: URL?
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
/// Everything it does is recorded as diagnostics so failures are debuggable.
final class AceLookupService {
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage?
    private var visitedStoreCode: String?

    static let base = "https://www.acehardware.com"
    static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 60
        config.httpAdditionalHeaders = [
            "User-Agent": Self.userAgent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        ]
        cookieStorage = config.httpCookieStorage
        session = URLSession(configuration: config)
    }

    // MARK: Main entry point

    func lookup(sku: String, storeCode: String) async -> LookupOutcome {
        var out = LookupOutcome()
        let query = sku.trimmingCharacters(in: .whitespacesAndNewlines)

        // Step 1 — visit the store page so the session carries the local
        // store context (cookies) before we ask for a product.
        if visitedStoreCode != storeCode {
            let storeURL = URL(string: "\(Self.base)/store-details/\(storeCode)")!
            switch await fetchHTML(storeURL) {
            case .success(let page):
                visitedStoreCode = storeCode
                setPreferredStoreCookie(storeCode)
                out.diagnostics.append(DiagnosticEntry(
                    title: "Store context loaded (store #\(storeCode))",
                    detail: page.finalURL.absoluteString, ok: true))
            case .failure(let error):
                out.diagnostics.append(DiagnosticEntry(
                    title: "Store page request failed",
                    detail: error.message, ok: false))
            }
            // Small pause between requests — be polite, look human.
            try? await Task.sleep(nanoseconds: 400_000_000)
        }

        // Step 2 — resolve the SKU to a product page via site search.
        // An exact SKU match usually redirects straight to the product page.
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        guard let searchURL = URL(string: "\(Self.base)/search?query=\(encoded)") else {
            out.errorSummary = "Invalid SKU text."
            return out
        }

        var productHTML: String?
        var productURL: URL?

        switch await fetchHTML(searchURL) {
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
                        switch await fetchHTML(linkURL) {
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
                        title: "No product link found in search results",
                        detail: "The results page had no recognizable product URL for \"\(query)\".",
                        ok: false))
                }
            }
        case .failure(let error):
            out.diagnostics.append(DiagnosticEntry(
                title: "Search request failed",
                detail: error.message, ok: false))
            out.errorSummary = Self.friendlyMessage(for: error)
        }

        // Step 3 — extract product data from the page.
        if let html = productHTML, let url = productURL {
            parseProduct(html: html, pageURL: url, sku: query, into: &out)
        } else if out.errorSummary == nil {
            out.errorSummary = "Couldn't find a product for \"\(query)\" on acehardware.com. Double-check the SKU, or fill the sign in manually."
        }
        return out
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
            if let ldSKU = (product["sku"] as? String) ?? (product["mpn"] as? String),
               !ldSKU.isEmpty, !ldSKU.contains(sku), !sku.contains(ldSKU) {
                out.diagnostics.append(DiagnosticEntry(
                    title: "Note: page SKU differs from what you typed",
                    detail: "Page reports \(ldSKU), you entered \(sku). Verify this is the right product.",
                    ok: false))
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

        // -- Embedded JSON app state (Next.js data, window.__STATE__, Kibo preload…)
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

        // -- Meta tag fallbacks.
        if out.productName == nil || out.productName!.isEmpty {
            if let title = HTMLParsers.metaContent(propertyOrName: "og:title", in: html) ?? HTMLParsers.pageTitle(in: html) {
                out.productName = Self.stripSiteSuffix(HTMLParsers.decodeEntities(title))
                out.diagnostics.append(DiagnosticEntry(
                    title: "Product name taken from page title", detail: out.productName ?? "", ok: true))
            }
        }
        if let ogImage = HTMLParsers.metaContent(propertyOrName: "og:image", in: html) {
            imageCandidates.append(ogImage)
        }

        // -- Raw-HTML price patterns as a last resort.
        for value in HTMLParsers.priceRegexFallback(in: html) {
            rawPrices.append(RawPrice(key: "price", path: "html", value: value))
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

    private func setPreferredStoreCookie(_ storeCode: String) {
        // Best-effort hint; harmless if the site ignores it. The real store
        // context comes from cookies the store-details page sets itself.
        if let cookie = HTTPCookie(properties: [
            .domain: ".acehardware.com",
            .path: "/",
            .name: "preferredStore",
            .value: storeCode,
            .expires: Date(timeIntervalSinceNow: 60 * 60 * 24 * 30),
        ]) {
            cookieStorage?.setCookie(cookie)
        }
    }

    private struct FetchedPage {
        let html: String
        let finalURL: URL
    }

    private func fetchHTML(_ url: URL) async -> Result<FetchedPage, LookupError> {
        switch await fetchData(url) {
        case .success(let fetched):
            let html = String(data: fetched.data, encoding: .utf8) ?? String(decoding: fetched.data, as: UTF8.self)
            return .success(FetchedPage(html: html, finalURL: fetched.finalURL))
        case .failure(let error):
            return .failure(error)
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

    private static func looksLikeProductPath(_ path: String, sku: String) -> Bool {
        if path.contains("/search") { return false }
        if path.contains("/departments/") || path.hasPrefix("/p/") { return true }
        if !sku.isEmpty, path.hasSuffix("/" + sku) { return true }
        return false
    }

    private static func friendlyMessage(for error: LookupError) -> String {
        let msg = error.message
        if msg.contains("HTTP 403") {
            return "acehardware.com refused the request (HTTP 403). The site occasionally rate-limits — wait a minute and try again. If it persists, open Diagnostics and share the log."
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
