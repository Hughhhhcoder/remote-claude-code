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
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Keep Vite's preload helper in the entry's direct dep graph
          // (vendor) so that routing monaco-editor to its own chunk does not
          // drag the helper — and hence the entire monaco chunk — into the
          // initial static-import graph of the entry.
          if (id.includes("vite/preload-helper")) return "vendor";
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("monaco-editor")) return "monaco";
          if (id.includes("libsodium")) return "sodium";
          if (
            id.includes("/yjs/") ||
            id.includes("/y-protocols/") ||
            id.includes("/y-websocket/") ||
            id.includes("/lib0/")
          )
            return "yjs";
          if (id.includes("@xterm")) return "xterm";
          if (id.includes("@simplewebauthn")) return "webauthn";
          if (id.includes("/solid-js/")) return "solid";
          return "vendor";
        },
      },
    },
  },
});
