import Foundation
import WebKit

/// Loads pages in an invisible WKWebView — the same engine Safari uses — so
/// bot-protection scripts (Akamai on acehardware.com) run and validate their
/// cookies exactly as they would for a real visitor. Cookies live in the
/// default website data store, so once a session is trusted, later lookups
/// are fast and unchallenged, across app launches too.
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
    private var lastStatus = 0
    private var challengeReloadUsed = false

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1280, height: 900),
                            configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.customUserAgent = AceLookupService.userAgent
    }

    /// Loads `url`, waits for scripts to settle, and returns the rendered DOM.
    func fetch(_ url: URL, timeout: TimeInterval = 35) async throws -> Page {
        guard continuation == nil else {
            throw LookupError(message: "Another page load is already in progress.")
        }
        webView.stopLoading()
        lastStatus = 0
        challengeReloadUsed = false

        return try await withCheckedThrowingContinuation { cont in
            continuation = cont
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                self?.finish(.failure(LookupError(message: "Timed out loading \(url.absoluteString)")))
            }
            var request = URLRequest(url: url)
            request.timeoutInterval = timeout
            self.webView.load(request)
        }
    }

    private func finish(_ result: Result<Page, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        switch result {
        case .success(let page): cont.resume(returning: page)
        case .failure(let error): cont.resume(throwing: error)
        }
    }

    /// Reads the DOM after a short settle delay; retries while the page still
    /// looks like an in-progress bot challenge, with at most one reload.
    private func harvest(attempt: Int) async {
        try? await Task.sleep(nanoseconds: 1_300_000_000)
        guard continuation != nil else { return }

        let raw = try? await webView.evaluateJavaScript("document.documentElement.outerHTML")
        let html = (raw as? String) ?? ""
        let lowered = html.lowercased()
        let looksBlocked = html.count < 2500 && (
            lowered.contains("access denied")
            || lowered.contains("cp_challenge")
            || lowered.contains("captcha")
            || lowered.contains("pardon our interruption")
        )

        if html.count < 1200 || looksBlocked {
            if attempt < 3 {
                await harvest(attempt: attempt + 1)
                return
            }
            if looksBlocked && !challengeReloadUsed {
                // The challenge script may have validated cookies by now —
                // one fresh navigation with those cookies usually succeeds.
                challengeReloadUsed = true
                webView.reload()
                return
            }
        }

        finish(.success(Page(html: html,
                             finalURL: webView.url ?? URL(string: "about:blank")!,
                             status: lastStatus)))
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
        Task { [weak self] in
            await self?.harvest(attempt: 1)
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
        finish(.failure(LookupError(message: error.localizedDescription)))
    }
}
