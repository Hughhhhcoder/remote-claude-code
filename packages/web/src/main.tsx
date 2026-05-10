/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { App } from "./App.tsx";
import { PrimitivesPreview } from "./dev/PrimitivesPreview.tsx";
import { PerfOverlay } from "./dev/PerfOverlay.tsx";
import { installSW } from "./sw-registration.ts";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

// Dev-only primitives gallery. Keep router-free; a single pathname switch
// keeps main.tsx minimal and adds zero bundle cost for the main app.
if (typeof location !== "undefined" && location.pathname === "/dev/primitives") {
  render(() => <PrimitivesPreview />, root);
} else {
  render(() => <App />, root);
}

// Dev-only perf overlay. Mounted when `?debug=1` is present; can be
// toggled at runtime with Cmd/Ctrl+Shift+P. Kept outside the app root
// so it never affects production bundles of consumers who don't opt in.
if (
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("debug") === "1"
) {
  const perfRoot = document.createElement("div");
  perfRoot.id = "rcc-perf-overlay-root";
  document.body.appendChild(perfRoot);
  render(() => <PerfOverlay />, perfRoot);
}

// Register service worker after initial render so first paint isn't
// competing with SW install. Bypass via ?nosw=1 for dev.
if (typeof window !== "undefined") {
  window.addEventListener("load", () => installSW());
}
