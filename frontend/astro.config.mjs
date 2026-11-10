import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://empresas.vivaion.com.br",
  output: "static",
  prefetch: { prefetchAll: false },
  vite: {
    server: {
      proxy: {
        "/api": { target: "http://127.0.0.1:8082", changeOrigin: false }
      }
    }
  }
});
