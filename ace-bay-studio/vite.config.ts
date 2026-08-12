import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' so the built app loads over file:// inside Electron.
// Ports are offset from ace-document-studio's (5173/4173) so both apps
// can be developed side by side.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    target: 'chrome120',
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
