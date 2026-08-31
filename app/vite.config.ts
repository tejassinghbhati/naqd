import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The stats API runs beside this app. Proxying it keeps the browser on one
    // origin, so no CORS preflight and no hard-coded localhost in the bundle.
    proxy: { "/api": { target: "http://localhost:8787", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
