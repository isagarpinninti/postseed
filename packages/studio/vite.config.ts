import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development, run `postseed --no-open` in another terminal and point VITE_POSTSEED_TARGET at it,
// with VITE_POSTSEED_TOKEN set to the token from its printed link.
const target = process.env.VITE_POSTSEED_TARGET ?? "http://127.0.0.1:4310";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false, target: "es2022", chunkSizeWarningLimit: 700 },
  server: { proxy: { "/api": { target, changeOrigin: false, headers: { host: new URL(target).host } } } },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
