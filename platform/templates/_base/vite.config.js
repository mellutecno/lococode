import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// App generata vive sotto __BASE_PATH__ in produzione. In dev gira da root.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: mode === "production" ? "__BASE_PATH__" : "/",
    plugins: [react()],
    server: {
      port: 5180,
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
