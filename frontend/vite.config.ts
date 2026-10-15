import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev/preview servers proxy /api to the FastAPI backend, so the app uses relative URLs.
// Point elsewhere with API_PROXY_TARGET=http://host:port, or set VITE_API_BASE at build time.
const api = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pages and the 3D viewer are lazy chunks; scan them all at startup so a fresh dev server never
  // discovers three.js mid-session (that re-bundles deps and breaks the pending dynamic import).
  optimizeDeps: {
    entries: ["index.html", "src/**/*.{ts,tsx}"],
    include: ["three", "@react-three/fiber", "@react-three/drei", "polygon-clipping", "react-router"],
  },
  server: { port: 5173, proxy: { "/api": { target: api, changeOrigin: true } } },
  preview: { port: 4173, proxy: { "/api": { target: api, changeOrigin: true } } },
});
