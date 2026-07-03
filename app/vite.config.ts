import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri expects a fixed dev port; the frontend also runs standalone in a plain
// browser (npm run dev) so the UI agent + verifier can test without the shell.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
    host: host || false,
    watch: { ignore: ["**/src-tauri/**"] },
    // Proxy the Hermes backend through the dev origin so browser requests are
    // same-origin. This avoids the cross-origin CORS *preflight*, which the
    // Hermes auth middleware rejects with 401 (OPTIONS carries no token — see
    // web_server.py auth_middleware). Same-origin GET/POST with the token
    // header are "not simple" but need no preflight when Content-Type is JSON…
    // actually to be safe we route everything through the proxy and the client
    // uses a relative base URL (see VITE_HERMES_PROXY handling in rest.ts/ws.ts).
    proxy: {
      "/hermes-api": {
        target: "http://127.0.0.1:9119",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/hermes-api/, ""),
        ws: true,
      },
    },
  },
});
