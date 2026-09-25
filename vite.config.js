import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  server: {
    host: true,
    port: 5000,
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
