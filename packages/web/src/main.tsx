/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { App } from "./App.tsx";
import { PrimitivesPreview } from "./dev/PrimitivesPreview.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

// Dev-only primitives gallery. Keep router-free; a single pathname switch
// keeps main.tsx minimal and adds zero bundle cost for the main app.
if (typeof location !== "undefined" && location.pathname === "/dev/primitives") {
  render(() => <PrimitivesPreview />, root);
} else {
  render(() => <App />, root);
}
