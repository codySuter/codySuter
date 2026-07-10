import Foundation
import WebKit

/// Loads pages in an invisible WKWebView — the same engine Safari uses — so
/// bot-protection scripts (Akamai on acehardware.com) run and validate their
/// cookies exactly as they would for a real visitor. Cookies live in the
/// default website data store, so once a session is trusted, later lookups
/// are fast and unchallenged, across app launches too.
///
/// Because the site renders search results with JavaScript after the page
/// "finishes" loading, callers can pass a `readinessProbe` — a JS expression
/// returning a boolean — and the fetcher polls until it's true (bounded)
/// before reading the DOM.
///
/// Every fetch gets a generation token; harvest chains and the timeout carry
/// it and become inert the moment a newer fetch starts, so a slow chain from
/// a timed-out fetch can never resume a later fetch's continuation with the
/// wrong page. Within one fetch, each main-frame didFinish (bot challenges
/// navigate on their own) replaces the previous harvest chain.
@MainActor
final class WebPageFetcher: NSObject, WKNavigationDelegate {
    struct Page {
        let html: String
        let finalURL: URL
        let status: Int
    }

    private let webView: WKWebView
    private var continuation: CheckedContinuation<Page, Error>?
    private var timeoutTask: Task<Void, Never>?
    private var harvestTask: Task<Void, Never>?
    private var lastStatus = 0
    private var challengeReloadUsed = false
    private var readinessProbe: String?
    private var minContentLength = 1200
    private var generation = 0

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1280, height: 900),
                            configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.customUserAgent = AceLookupService.userAgent
    }

    /// JS used to read page content once ready. Default returns the full DOM;
    /// JSON endpoints use the body text extractor instead.
    private var contentScript = "document.documentElement.outerHTML"
    static let domExtractor = "document.documentElement.outerHTML"
    static let bodyTextExtractor = "(document.body ? (document.body.innerText || document.body.textContent) : '')"

    /// Loads `url`, waits for scripts to settle (and `readinessProbe`, if
    /// given, to come true), and returns the rendered content (DOM by default,
    /// or whatever `contentScript` extracts).
    func fetch(_ url: URL, timeout: TimeInterval = 40, readinessProbe: String? = nil,
               contentScript: String = WebPageFetcher.domExtractor,
               minContentLength: Int = 1200) async throws -> Page {
        guard continuation == nil else {
            throw LookupError(message: "Another page load is already in progress.")
        }
        generation += 1
        let gen = generation
        webView.stopLoading()
        harvestTask?.cancel()
        harvestTask = nil
        lastStatus = 0
        challengeReloadUsed = false
        self.readinessProbe = readinessProbe
        self.contentScript = contentScript
        self.minContentLength = minContentLength

        return try await withCheckedThrowingContinuation { cont in
            continuation = cont
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self?.finish(.failure(LookupError(message: "Timed out loading \(url.absoluteString)")),
                             forGeneration: gen)
            }
            var request = URLRequest(url: url)
            request.timeoutInterval = timeout
            self.webView.load(request)
        }
    }

    private func finish(_ result: Result<Page, Error>, forGeneration gen: Int) {
        guard gen == generation, let cont = continuation else { return }
        continuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        harvestTask?.cancel()
        harvestTask = nil
        switch result {
        case .success(let page): cont.resume(returning: page)
        case .failure(let error): cont.resume(throwing: error)
        }
    }

    /// Reads the DOM after a settle delay; keeps waiting while the page still
    /// looks like an in-progress bot challenge or the readiness probe says
    /// content hasn't rendered yet. Bounded to 8 rounds with at most one
    /// challenge reload per fetch. Bails silently the moment its generation
    /// is stale or its task is replaced.
    private func harvest(attempt: Int, gen: Int) async {
        try? await Task.sleep(nanoseconds: 900_000_000)
        guard stillCurrent(gen) else { return }

        let raw = try? await webView.evaluateJavaScript(contentScript)
        guard stillCurrent(gen) else { return }
        let html = (raw as? String) ?? ""
        let lowered = html.lowercased()
        let looksBlocked = html.count < 2500 && (
            lowered.contains("access denied")
            || lowered.contains("cp_challenge")
            || lowered.contains("captcha")
            || lowered.contains("pardon our interruption")
        )

        var ready = true
        if let probe = readinessProbe {
            ready = ((try? await webView.evaluateJavaScript(probe)) as? Bool) ?? false
            guard stillCurrent(gen) else { return }
        }

        if html.count < minContentLength || looksBlocked || !ready {
            if looksBlocked, !challengeReloadUsed, attempt >= 3 {
                // The challenge script may have validated cookies by now —
                // one fresh navigation with those cookies usually succeeds.
                challengeReloadUsed = true
                webView.reload()
                return
            }
            if attempt < 8 {
                await harvest(attempt: attempt + 1, gen: gen)
                return
            }
            // Out of attempts — return what we have; diagnostics will show it.
        }

        finish(.success(Page(html: html,
                             finalURL: webView.url ?? URL(string: "about:blank")!,
                             status: lastStatus)),
               forGeneration: gen)
    }

    private func stillCurrent(_ gen: Int) -> Bool {
        !Task.isCancelled && gen == generation && continuation != nil
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame,
           let http = navigationResponse.response as? HTTPURLResponse {
            lastStatus = http.statusCode
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let gen = generation
        harvestTask?.cancel()
        harvestTask = Task { [weak self] in
            await self?.harvest(attempt: 1, gen: gen)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    private func handleFailure(_ error: Error) {
        // Redirects and stopLoading surface as "cancelled" — not real failures.
        if (error as NSError).code == NSURLErrorCancelled { return }
        finish(.failure(LookupError(message: error.localizedDescription)), forGeneration: generation)
    }
}
