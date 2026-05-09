import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:7777",
        ws: true,
        changeOrigin: true,
      },
      "/pair": {
        target: "http://localhost:7777",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:7777",
        changeOrigin: true,
      },
    },
  },
});
