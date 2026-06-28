// Convenience launcher: start the Vite dev server, then open Electron pointed
// at it (hot reload in a desktop window). Used by `npm run electron:dev`.
import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) {
  console.error("Could not resolve Vite dev server URL");
  process.exit(1);
}
console.log(`Vite dev server: ${url}`);

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on("close", async () => {
  await server.close();
  process.exit(0);
});
