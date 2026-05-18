import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Console vive a root in produzione (mellucode.mellutecno.it/). In dev e' alla
// root del dev server. Nessun subpath: base resta "/".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "/",
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/v1": {
          target: env.VITE_API_URL || "https://mellucode.mellutecno.it",
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
