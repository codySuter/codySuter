import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' so the built app loads over file:// inside Electron.
// Ports are offset from the other Ace Studio apps (5173/4173 document,
// 5174/4174 bay) so the whole family can be developed side by side.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    target: 'chrome120',
  },
  server: {
    port: 5175,
    strictPort: true,
  },
});
