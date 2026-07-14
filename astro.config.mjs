import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://lacoparena.es",
  output: "static",
  build: {
    format: "directory"
  }
});
