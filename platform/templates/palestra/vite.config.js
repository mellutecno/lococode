import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vive sotto subpath /demo/palestra/ in produzione (nginx fa il routing).
// In dev gira da root (vite dev server), quindi base e' relativa.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: mode === "production" ? "/demo/palestra/" : "/",
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // In dev proxy le chiamate /v1/* verso il backend reale per evitare CORS.
        "/v1": {
          target: env.VITE_API_URL || "https://mellucode.mellutecno.it",
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
