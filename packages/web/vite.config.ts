import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Inject a per-build VERSION into `public/sw.js` after Rollup writes the
 * bundle. We hash the generated asset filenames (already content-hashed by
 * Vite) so every build that materially changes any shipped file gets a
 * fresh VERSION → fresh cache bucket names → the SW's `activate` handler
 * nukes prior caches on the next reload. No runtime cost and no new deps.
 */
function injectSwVersion(): Plugin {
  let outDir = "dist";
  let hash = "dev";
  return {
    name: "rcc-sw-version",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir || "dist";
    },
    // Run after write so `public/sw.js` has been copied to outDir and all
    // asset filenames are finalized.
    writeBundle(_opts, bundle) {
      const names: string[] = [];
      for (const key of Object.keys(bundle)) names.push(key);
      names.sort();
      hash = createHash("sha256")
        .update(names.join("\n"))
        .digest("hex")
        .slice(0, 12);
    },
    async closeBundle() {
      const swPath = resolve(outDir, "sw.js");
      try {
        const src = await readFile(swPath, "utf8");
        if (!src.includes("__BUILD_VERSION__")) return;
        const out = src.replaceAll("__BUILD_VERSION__", hash);
        await writeFile(swPath, out);
      } catch {
        // sw.js absent (e.g. test build) — nothing to stamp.
      }
    },
  };
}

export default defineConfig({
  plugins: [solid(), injectSwVersion()],
  server: {
    port: 5273,
    strictPort: true,
    // Mirror the host's production security headers so dev behavior matches
    // prod (catches CSP violations locally instead of in production). See
    // packages/host/src/security-headers.ts for rationale.
    headers: {
      "content-security-policy": [
        "default-src 'self'",
        // Vite dev server uses ws: on the same origin for HMR.
        "connect-src 'self' wss: ws:",
        "img-src 'self' data: blob:",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join("; "),
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
      "cross-origin-resource-policy": "same-origin",
      "permissions-policy": [
        "camera=()",
        "microphone=(self)",
        "geolocation=()",
        "interest-cohort=()",
        "browsing-topics=()",
        "publickey-credentials-get=(self)",
      ].join(", "),
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
    },
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
