"""Tools the model can call: DuckDuckGo search and page fetching.

Both are synchronous; the agent runs them via asyncio.to_thread so the
Telegram event loop stays responsive while the Pi works.
"""

import logging

import httpx
import trafilatura
from ddgs import DDGS

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


def web_search(query: str, max_results: int = 5) -> str:
    log.info("web_search: %r", query)
    try:
        results = list(DDGS().text(query, max_results=max_results))
    except Exception as exc:
        return f"Search failed: {exc}"
    if not results:
        return "No results found. Try different keywords."

    lines = []
    for i, r in enumerate(results, 1):
        title = r.get("title") or "(no title)"
        url = r.get("href") or r.get("url") or ""
        snippet = (r.get("body") or "").strip()
        lines.append(f"{i}. {title}\n   URL: {url}\n   {snippet}")
    return "\n".join(lines)


def fetch_page(url: str, char_limit: int = 6000) -> str:
    log.info("fetch_page: %s", url)
    if not url.startswith(("http://", "https://")):
        return "Invalid URL: must start with http:// or https://"
    try:
        resp = httpx.get(
            url,
            follow_redirects=True,
            timeout=25,
            headers={"User-Agent": USER_AGENT},
        )
        resp.raise_for_status()
    except Exception as exc:
        return f"Could not fetch the page: {exc}"

    text = trafilatura.extract(resp.text, url=url, include_links=False) or ""
    text = text.strip()
    if not text:
        return "Fetched the page but could not extract readable text from it."
    if len(text) > char_limit:
        text = text[:char_limit] + "\n[...truncated]"
    return text
