import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base so the built app also works when loaded from the
  // Electron desktop wrapper (assets resolve under the app:// protocol).
  base: "./",
  plugins: [react(), tailwindcss()],
});
