/**
 * Mock acehardware.com for e2e runs: serves product pages with JSON-LD,
 * the Mozu storefront price API, product images, and a /__setprice control
 * endpoint so tests can simulate price changes between lookups.
 *
 * The app under test points at it via ACE_BASE_URL + ACE_LOOKUP_MODE=http.
 */
import http from "http";

// 1×1 red PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export function startMockAce() {
  const products = {
    81995: { name: "Ace Premium Wild Bird Food 20 lb", price: 12.99, sale: null },
    3000003: { name: "DeWalt 20V MAX Drill Kit", price: 129.0, sale: null },
    2000002: { name: "Scotts Turf Builder 5M", price: 24.99, sale: 19.99 },
    8315087: { name: "Warmup Product", price: 1.0, sale: null }, // session warmup page
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    // test control: change a price mid-run
    if (path === "/__setprice") {
      const sku = url.searchParams.get("sku");
      const p = products[sku];
      if (p) {
        p.price = parseFloat(url.searchParams.get("price"));
        const sale = url.searchParams.get("sale");
        p.sale = sale ? parseFloat(sale) : null;
      }
      res.writeHead(p ? 200 : 404).end("ok");
      return;
    }

    if (path.startsWith("/img/")) {
      res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
      return;
    }

    // Mozu storefront price API
    const api = path.match(/^\/api\/commerce\/catalog\/storefront\/products\/(\d+)$/);
    if (api) {
      const p = products[api[1]];
      if (!p) {
        res.writeHead(404, { "Content-Type": "application/json" }).end("{}");
        return;
      }
      const base = `http://127.0.0.1:${server.address().port}`;
      const body = {
        price: Object.assign({ price: p.price }, p.sale != null ? { salePrice: p.sale } : {}),
        content: {
          productName: p.name,
          productImages: [{ imageUrl: `${base}/img/${api[1]}.png` }],
        },
      };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      return;
    }

    // product page with JSON-LD
    const prod = path.match(/^\/product\/(\d+)$/);
    if (prod) {
      const p = products[prod[1]];
      if (!p) {
        // bot-protection-style empty shell, like the real site serves plain clients
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
        offers: { "@type": "Offer", price: String(p.sale != null ? p.sale : p.price), priceCurrency: "USD" },
      };
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<html><head><title>${p.name}</title>` +
          `<script type="application/ld+json">${JSON.stringify(ld)}</script>` +
          `</head><body>${p.name}</body></html>`
      );
      return;
    }

    if (path === "/search") {
      // first product link wins
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<html><body><a href="/product/3000003">DeWalt 20V MAX Drill Kit</a></body></html>`
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end("<html><body>mock ace</body></html>");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        setPrice(sku, price, sale) {
          const q = new URL(`http://127.0.0.1:${server.address().port}/__setprice`);
          q.searchParams.set("sku", sku);
          q.searchParams.set("price", String(price));
          if (sale != null) q.searchParams.set("sale", String(sale));
          return fetch(q).then((r) => r.text());
        },
        close: () => server.close(),
      });
    });
  });
}
