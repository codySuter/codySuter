// Electron main process — wraps the built Vite SPA as a desktop app.
//
// The production build is served over a custom `app://` protocol rather than
// `file://`. A real (standard, secure) origin guarantees IndexedDB — the app's
// entire persistence layer — behaves exactly as it does in a browser tab.

const { app, BrowserWindow, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const DIST = path.join(__dirname, "..", "dist");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

// Register before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

async function serveFromDist(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname || pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(DIST, pathname));
  // Block path traversal outside the bundle.
  if (!filePath.startsWith(DIST)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return new Response(data, {
      status: 200,
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  } catch {
    // SPA fallback: unknown path → index.html
    try {
      const html = await fs.readFile(path.join(DIST, "index.html"));
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b1120",
    title: "Encounter Board",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadURL("app://bundle/index.html");
  }

  // Open any external links (e.g. SRD art URLs) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  protocol.handle("app", serveFromDist);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
