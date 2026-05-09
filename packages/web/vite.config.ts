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
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/monaco-editor")) return "monaco";
          if (id.includes("node_modules/@xterm")) return "xterm";
          if (id.includes("node_modules/yjs")) return "yjs";
          if (id.includes("node_modules/libsodium-wrappers")) return "sodium";
          if (id.includes("node_modules/@simplewebauthn")) return "webauthn";
          return undefined;
        },
      },
    },
  },
});
