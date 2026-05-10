/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { App } from "./App.tsx";
import { PrimitivesPreview } from "./dev/PrimitivesPreview.tsx";
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

// Register service worker after initial render so first paint isn't
// competing with SW install. Bypass via ?nosw=1 for dev.
if (typeof window !== "undefined") {
  window.addEventListener("load", () => installSW());
}
