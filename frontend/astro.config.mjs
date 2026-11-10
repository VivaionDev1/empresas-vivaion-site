import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://empresas.vivaion.com.br",
  output: "static",
  prefetch: { prefetchAll: false }
});
