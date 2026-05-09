# scratchpad — RCC Plugin Example

A pure UI plugin: no host permissions, no backend. The iframe stores notes
in `localStorage`, scoped per session. Demonstrates the simplest possible
plugin shape — an iframe with a single HTML file.

## Install

```bash
cp -R examples/plugins/scratchpad ~/.rcc/plugins/scratchpad
# restart host
```

## Permissions

None. The plugin has `"permissions": []` in its manifest.

## How it works

- `manifest.json` declares `ui: "public"` → RCC serves the directory at
  `/plugins/scratchpad/*` and the Plugins config tab shows an "Open" button.
- The iframe reads the current session id from a `window.postMessage({
  type: "rcc.session", sid }, ...)` from the parent window, and/or from the
  `?sid=` URL query on load.
- State is persisted in `localStorage` under
  `rcc.plugin.scratchpad.<sid>` — per-session silos.
- On load the iframe posts `{ type: "rcc.plugin.ready", pluginId:
  "scratchpad" }` to the parent so the parent knows when to send the
  session sid.

## Wiring the parent (optional)

The parent RCC web client can bridge session changes to the iframe:

```ts
iframe.addEventListener("load", () => {
  iframe.contentWindow?.postMessage({ type: "rcc.session", sid: activeSid }, "*");
});
```

If no sid is available, the scratchpad falls back to a `__global__` silo.
