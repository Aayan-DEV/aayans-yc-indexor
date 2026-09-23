import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.resolve(import.meta.dirname, "..");
export default defineConfig({
  root: path.join(root, "cloudflare"),
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": root } },
  build: { outDir: "dist", emptyOutDir: false },
});
