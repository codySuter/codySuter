/**
 * Mock acehardware.com that reproduces the REAL site's bot protection, which
 * the existing e2e mock does not: a client without a cleared session gets a
 * challenge shell + 401 on the price API; only a browser that runs the
 * challenge JS earns the cookie that unlocks both.
 *
 * Env:
 *   HYDRATE_MS  extra delay before the product SPA is usable (default 700)
 *   API_MS      storefront API latency (default 120)
 */
import http from "http";

const HYDRATE_MS = Number(process.env.HYDRATE_MS ?? 700);
const API_MS = Number(process.env.API_MS ?? 120);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const products = {
  81995: { name: "Ace Premium Wild Bird Food 20 lb", price: 12.99, sale: null },
  3000003: { name: "DeWalt 20V MAX Drill Kit", price: 129.0, sale: null },
  2000002: { name: "Scotts Turf Builder 5M", price: 24.99, sale: 19.99 },
  8315087: { name: "Warmup Product", price: 1.0, sale: null },
};
for (let i = 0; i < 40; i++) {
  products[String(5000000 + i)] = { name: `Bulk Test Item ${i}`, price: 10 + i, sale: null };
}

const hits = { api200: 0, api401: 0, page: 0, challenge: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleared = (req) => /(?:^|;\s*)ace_clear=1/.test(req.headers.cookie || "");

export function startMockBotAce() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    if (path === "/__stats") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(hits));
      return;
    }
    if (path === "/__reset") {
      hits.api200 = hits.api401 = hits.page = hits.challenge = 0;
      res.writeHead(200).end("ok");
      return;
    }
    if (path.startsWith("/img/")) {
      res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
      return;
    }

    // ---- storefront price API: gated on the cleared-session cookie ----
    const api = path.match(/^\/api\/commerce\/catalog\/storefront\/products\/(\d+)$/);
    if (api) {
      await sleep(API_MS);
      if (!cleared(req)) {
        hits.api401++;
        res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"unauthorized"}');
        return;
      }
      hits.api200++;
      const p = products[api[1]];
      if (!p) {
        res.writeHead(404, { "Content-Type": "application/json" }).end("{}");
        return;
      }
      const base = `http://127.0.0.1:${server.address().port}`;
      const body = {
        content: { productName: p.name, productImages: [{ imageUrl: `${base}/img/${api[1]}.png` }] },
      };
      body.price = Object.assign({ price: p.price }, p.sale != null ? { salePrice: p.sale } : {});
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      return;
    }

    // ---- product page ----
    const prod = path.match(/^\/product\/(\d+)$/);
    if (prod) {
      if (!cleared(req)) {
        // Bot challenge: a shell with no product data. Real browsers run the
        // JS, get the cookie, and reload into the real page.
        hits.challenge++;
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Set-Cookie": "ace_clear=1; Path=/",
        }).end(
          `<html><head><title>Just a moment…</title></head><body>
             <div id="challenge">Checking your browser…</div>
             <script>setTimeout(()=>location.reload(), 250);</script>
           </body></html>`
        );
        return;
      }
      hits.page++;
      const p = products[prod[1]];
      if (!p) {
        res.writeHead(404, { "Content-Type": "text/html" }).end("<html><body></body></html>");
        return;
      }
      const base = `http://127.0.0.1:${server.address().port}`;
      const ld = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.name,
        sku: prod[1],
        image: `${base}/img/${prod[1]}.png`,
        brand: { "@type": "Brand", name: "Ace" },
        offers: { "@type": "Offer", price: String(p.sale ?? p.price), priceCurrency: "USD" },
      };
      // SPA: the shell arrives immediately, product markup hydrates later —
      // this is what made every navigation-based lookup expensive.
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<html><head><title>${p.name}</title></head><body>
           <div id="root">loading…</div>
           <script>
             setTimeout(() => {
               const s = document.createElement('script');
               s.type = 'application/ld+json';
               s.textContent = ${JSON.stringify(JSON.stringify(ld))};
               document.head.appendChild(s);
               const m = document.createElement('main');
               m.setAttribute('data-mz-product', ${JSON.stringify(prod[1])});
               m.textContent = ${JSON.stringify(p.name)};
               document.body.appendChild(m);
             }, ${HYDRATE_MS});
           </script>
         </body></html>`
      );
      return;
    }

    if (path === "/search") {
      if (!cleared(req)) {
        res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "ace_clear=1; Path=/" })
          .end(`<html><body><script>setTimeout(()=>location.reload(),250)</script></body></html>`);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<html><body><script>setTimeout(()=>{
           const a=document.createElement('a');a.href='/product/3000003';a.textContent='DeWalt';
           document.body.appendChild(a);
           const m=document.createElement('main');document.body.appendChild(m);
         },${HYDRATE_MS})</script></body></html>`
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end("<html><body><main>mock ace</main></body></html>");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        stats: () => fetch(`http://127.0.0.1:${server.address().port}/__stats`).then((r) => r.json()),
        reset: () => fetch(`http://127.0.0.1:${server.address().port}/__reset`).then((r) => r.text()),
        close: () => server.close(),
      })
    );
  });
}
