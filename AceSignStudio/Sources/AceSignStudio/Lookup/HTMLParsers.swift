import Foundation

/// Regex-based extraction helpers for acehardware.com pages. Nothing here is
/// specific to one page revision — every consumer treats these as candidate
/// sources and falls through when one comes up empty.
enum HTMLParsers {

    // MARK: Generic regex

    /// All matches; each match is [wholeMatch, group1, group2, …].
    static func matches(
        _ pattern: String,
        in text: String,
        options: NSRegularExpression.Options = [.caseInsensitive, .dotMatchesLineSeparators],
        limit: Int = 500
    ) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let ns = text as NSString
        let found = regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length))
        return found.prefix(limit).map { match in
            (0..<match.numberOfRanges).map { index in
                let range = match.range(at: index)
                return range.location == NSNotFound ? "" : ns.substring(with: range)
            }
        }
    }

    // MARK: JSON-LD

    /// All schema.org Product dictionaries found in <script type="application/ld+json"> blocks.
    static func jsonLDProducts(in html: String) -> [[String: Any]] {
        var products: [[String: Any]] = []

        func collect(_ any: Any) {
            if let dict = any as? [String: Any] {
                let type = dict["@type"]
                let typeStrings: [String]
                if let s = type as? String { typeStrings = [s] }
                else if let arr = type as? [String] { typeStrings = arr }
                else { typeStrings = [] }
                if typeStrings.contains(where: { $0.caseInsensitiveCompare("Product") == .orderedSame }) {
                    products.append(dict)
                }
                if let graph = dict["@graph"] { collect(graph) }
            } else if let array = any as? [Any] {
                array.forEach(collect)
            }
        }

        for match in matches("<script[^>]*type=\"application/ld\\+json\"[^>]*>(.*?)</script>", in: html, limit: 50) {
            guard match.count > 1 else { continue }
            if let parsed = parseJSONObject(match[1]) {
                collect(parsed)
            }
        }
        return products
    }

    // MARK: Embedded JSON application state

    /// Parsed JSON blobs embedded in the page: framework data islands
    /// (`<script type="application/json">`, which covers Next.js __NEXT_DATA__),
    /// `window.__SOMETHING__ = {…}` assignments, and Kibo/Mozu preload attributes.
    static func embeddedJSONBlobs(in html: String) -> [Any] {
        var blobs: [Any] = []

        for match in matches("<script[^>]*type=\"application/json\"[^>]*>(.*?)</script>", in: html, limit: 40) {
            guard match.count > 1, match[1].count > 20 else { continue }
            if let parsed = parseJSONObject(match[1]) { blobs.append(parsed) }
        }

        for match in matches("window\\.__([A-Za-z0-9_]{3,60})__\\s*=\\s*(\\{.*?)</script>", in: html, limit: 20) {
            guard match.count > 2 else { continue }
            if let parsed = parseJSONObject(match[2]) { blobs.append(parsed) }
        }

        // Kibo/Mozu (the platform behind acehardware.com) preloads product data
        // into HTML-escaped attributes.
        for match in matches("data-mz-preload-[a-z]+=\"([^\"]{40,})\"", in: html, limit: 20) {
            guard match.count > 1 else { continue }
            if let parsed = parseJSONObject(decodeEntities(match[1])) { blobs.append(parsed) }
        }

        return blobs
    }

    /// Tolerant JSON parse: tries the string as-is, then the first balanced
    /// {...} / [...] prefix (handles trailing "; window.x = …" noise).
    static func parseJSONObject(_ raw: String) -> Any? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var candidates = [trimmed]
        if let balanced = balancedJSONPrefix(trimmed), balanced.count != trimmed.count {
            candidates.append(balanced)
        }
        for candidate in candidates {
            if let data = candidate.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) {
                return parsed
            }
        }
        return nil
    }

    /// The shortest prefix of `s` that forms a balanced JSON value starting at
    /// its first character ("{" or "["), respecting strings and escapes.
    static func balancedJSONPrefix(_ s: String) -> String? {
        guard s.hasPrefix("{") || s.hasPrefix("[") else { return nil }
        var depth = 0
        var inString = false
        var escaped = false
        var out = String()
        out.reserveCapacity(min(s.count, 1_000_000))
        for ch in s {
            out.append(ch)
            if escaped { escaped = false; continue }
            switch ch {
            case "\\": if inString { escaped = true }
            case "\"": inString.toggle()
            case "{", "[": if !inString { depth += 1 }
            case "}", "]":
                if !inString {
                    depth -= 1
                    if depth == 0 { return out }
                }
            default: break
            }
        }
        return nil
    }

    // MARK: Meta tags & title

    static func metaContent(propertyOrName key: String, in html: String) -> String? {
        let escaped = NSRegularExpression.escapedPattern(for: key)
        let patterns = [
            "<meta[^>]+(?:property|name)=\"\(escaped)\"[^>]+content=\"([^\"]+)\"",
            "<meta[^>]+content=\"([^\"]+)\"[^>]+(?:property|name)=\"\(escaped)\"",
        ]
        for pattern in patterns {
            if let m = matches(pattern, in: html, limit: 3).first, m.count > 1, !m[1].isEmpty {
                return decodeEntities(m[1])
            }
        }
        return nil
    }

    static func pageTitle(in html: String) -> String? {
        guard let m = matches("<title[^>]*>(.*?)</title>", in: html, limit: 2).first, m.count > 1 else { return nil }
        let title = decodeEntities(m[1]).trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }

    // MARK: Search-results product link

    /// True for an Ace item code: alphanumeric, 4–14 chars, ≥4 digits
    /// ("F031580", "8315087"); false for word slugs ("traeger", "bird-food").
    static func isProductCode<S: StringProtocol>(_ s: S) -> Bool {
        guard (4...14).contains(s.count),
              s.allSatisfy({ $0.isLetter || $0.isNumber })
        else { return false }
        return s.filter(\.isNumber).count >= 4
    }

    /// Finds the most plausible product-page link in a search results page.
    /// Only links whose path ends in an item code qualify — the site's
    /// navigation menu is full of /departments/ category and brand links
    /// (word slugs), and those must never win. Prefers links ending in /
    /// containing the SKU.
    static func firstProductLink(in html: String, sku: String) -> String? {
        // JSON-escaped slashes appear when links live inside embedded JSON.
        let normalized = html.replacingOccurrences(of: "\\/", with: "/")

        var links: [String] = []
        let patterns = [
            "href=\"((?:https://www\\.acehardware\\.com)?(?:/departments/|/p/)[^\"#?]+)",
            "\"(?:productUrl|seoUrl|url|productSeoUrl)\"\\s*:\\s*\"((?:https://www\\.acehardware\\.com)?(?:/departments/|/p/)[^\"#?]+)\"",
        ]
        for pattern in patterns {
            for match in matches(pattern, in: normalized, limit: 400) where match.count > 1 {
                let link = decodeEntities(match[1])
                guard let last = link.split(separator: "/").last,
                      isProductCode(last), !links.contains(link) else { continue }
                links.append(link)
            }
        }
        guard !links.isEmpty else { return nil }

        if !sku.isEmpty, let exact = links.first(where: { $0.hasSuffix("/" + sku) }) {
            return exact
        }
        if !sku.isEmpty, let containing = links.first(where: { $0.contains(sku) }) {
            return containing
        }
        return links.first
    }

    // MARK: Raw-HTML price fallback

    /// Price values scraped straight out of the HTML when structured data fails.
    static func priceRegexFallback(in html: String) -> [Double] {
        var values: [Double] = []
        let patterns = [
            "itemprop=\"price\"[^>]*content=\"([0-9]+(?:\\.[0-9]{1,2})?)\"",
            "\"price\"\\s*:\\s*\"?([0-9]+\\.[0-9]{2})\"?",
            "class=\"[^\"]*price[^\"]*\"[^>]*>\\s*\\$\\s*([0-9]+\\.[0-9]{2})",
        ]
        for pattern in patterns {
            for match in matches(pattern, in: html, options: [.caseInsensitive], limit: 20) where match.count > 1 {
                if let value = Double(match[1]) {
                    values.append(value)
                }
            }
            if !values.isEmpty { break }
        }
        return values
    }

    // MARK: HTML entities

    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = s
        let map: [String: String] = [
            "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
            "&#34;": "\"", "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
            "&#038;": "&", "&#8217;": "\u{2019}", "&#8220;": "\u{201C}", "&#8221;": "\u{201D}",
        ]
        for (entity, replacement) in map {
            out = out.replacingOccurrences(of: entity, with: replacement)
        }
        out = decodeNumericEntities(out)
        return out
    }

    private static func decodeNumericEntities(_ s: String) -> String {
        guard s.contains("&#"),
              let regex = try? NSRegularExpression(pattern: "&#(x?)([0-9a-fA-F]{1,6});")
        else { return s }
        let ns = s as NSString
        var result = ""
        var cursor = 0
        for match in regex.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let isHex = match.range(at: 1).length > 0
            let digits = ns.substring(with: match.range(at: 2))
            if let code = UInt32(digits, radix: isHex ? 16 : 10), let scalar = Unicode.Scalar(code) {
                result.append(Character(scalar))
            }
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return result
    }
}

// MARK: - Deep JSON scanning

/// Walks arbitrary parsed JSON looking for price-like fields and image URLs.
/// This keeps the lookup working even when the site reshuffles its app state,
/// because we match on key names rather than exact paths.
enum JSONScanner {

    static let priceKeys: Set<String> = [
        "price", "saleprice", "listprice", "storeprice", "memberprice", "retailprice",
        "regularprice", "finalprice", "currentprice", "promoprice", "storeonlyprice",
        "instoreprice", "wasprice", "msrp", "yourprice", "pickupprice", "originalprice",
    ]

    private static let imageKeys: Set<String> = [
        "image", "imageurl", "mainimage", "src", "imagepath", "thumbnail", "cdnimageurl",
    ]

    private static let maxHits = 400

    static func priceFields(in json: Any, into results: inout [(path: String, key: String, value: Double)]) {
        walkPrices(json, path: "", into: &results)
    }

    private static func walkPrices(_ json: Any, path: String, into results: inout [(path: String, key: String, value: Double)]) {
        guard results.count < maxHits else { return }
        if let dict = json as? [String: Any] {
            for (key, value) in dict {
                let lowered = key.lowercased()
                let childPath = path.isEmpty ? key : path + "." + key
                if priceKeys.contains(lowered) {
                    if let number = doubleValue(value) {
                        results.append((childPath, lowered, number))
                    } else if let sub = value as? [String: Any] {
                        // Price objects like {"amount": 12.99} or {"value": "12.99"}
                        for amountKey in ["amount", "value", "price"] {
                            if let number = doubleValue(sub[amountKey] as Any) {
                                results.append((childPath + "." + amountKey, lowered, number))
                                break
                            }
                        }
                    }
                }
                walkPrices(value, path: childPath, into: &results)
            }
        } else if let array = json as? [Any] {
            for (index, value) in array.enumerated() {
                walkPrices(value, path: path + "[\(index)]", into: &results)
            }
        }
    }

    static func imageURLs(in json: Any, into results: inout [String]) {
        guard results.count < maxHits else { return }
        if let dict = json as? [String: Any] {
            for (key, value) in dict {
                if imageKeys.contains(key.lowercased()), let s = value as? String, looksLikeImageURL(s) {
                    results.append(s)
                }
                imageURLs(in: value, into: &results)
            }
        } else if let array = json as? [Any] {
            for value in array {
                if let s = value as? String, looksLikeImageURL(s) {
                    results.append(s)
                } else {
                    imageURLs(in: value, into: &results)
                }
            }
        }
    }

    private static func looksLikeImageURL(_ s: String) -> Bool {
        guard s.hasPrefix("http") || s.hasPrefix("//") else { return false }
        let lowered = s.lowercased()
        if lowered.contains("mozu.com") || lowered.contains("acehardware") { return true }
        return [".jpg", ".jpeg", ".png", ".webp"].contains { lowered.contains($0) }
    }

    static func doubleValue(_ value: Any) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String {
            let cleaned = s.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
            return Double(cleaned)
        }
        return nil
    }
}
