import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/hermes": {
        target: "http://127.0.0.1:8642",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/hermes/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
          });
        },
      },
    },
  },
});