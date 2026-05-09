# RCC Plugin Authoring Guide

This guide covers everything you need to write, test, and distribute an RCC
plugin. RCC plugins extend the host without modifying core code: they can
observe sessions, broadcast events to all connected clients, accept
`plugin.call` RPCs from the UI, and ship their own iframe UI.

Plugins run inside the RCC host Node process. They have full filesystem and
network access. The `permissions` array only gates which host APIs are
exposed to the plugin's context — it is **not** a sandbox. Only install
plugins from authors you trust.

---

## Hello World (5 minutes)

Create `~/.rcc/plugins/hello-world/`:

```
~/.rcc/plugins/hello-world/
  manifest.json
  index.ts
```

**manifest.json**:

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "0.1.0",
  "entry": "index.ts",
  "permissions": []
}
```

**index.ts**:

```ts
export default {
  id: "hello-world",
  name: "Hello World",
  version: "0.1.0",
  onLoad(ctx) {
    ctx.log("hello from hello-world");
  },
  async handleCall(method, payload) {
    if (method === "ping") return { pong: true, got: payload };
    throw new Error(`unknown method: ${method}`);
  },
};
```

Restart the host. You should see:

```
[plugins] loaded hello-world@0.1.0
[plugin:hello-world] hello from hello-world
```

From any connected client send:

```json
{"v":1,"t":"plugin.call","pluginId":"hello-world","method":"ping","callId":"1","payload":{"x":1}}
```

You should get back:

```json
{"v":1,"t":"plugin.result","callId":"1","pluginId":"hello-world","ok":true,"data":{"pong":true,"got":{"x":1}}}
```

Done.

---

## manifest.json

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Lowercase, matches `[a-z0-9][a-z0-9-]{0,63}`. Must equal the directory name. |
| `name` | string | yes | Display name, ≤ 80 chars. |
| `version` | string | yes | Free-form semver-ish (`[0-9A-Za-z.+-]{1,32}`). |
| `entry` | string | yes | Path relative to the plugin dir. The host dynamic-imports this. Cannot escape the plugin dir. |
| `ui` | string | no | Directory (relative). Served at `/plugins/<id>/*` when set; the manifest UI tab gets an "Open" button. |
| `permissions` | string[] | no | Subset of `session:read`, `session:write`, `chat:read`, `broadcast`. Defaults to `[]`. |

The host validates the manifest on boot. Invalid manifests are skipped and
logged; they do not crash the host.

---

## Plugin interface

Your entry file's `default` export must be an object matching:

```ts
export type Plugin = {
  id: string;       // must === manifest.id
  name: string;     // must be present
  version: string;  // must be present

  onLoad?: (ctx: PluginContext) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
  handleCall?: (
    method: string,
    payload: unknown,
    ctx: PluginCallContext,
  ) => Promise<unknown> | unknown;
};
```

`onLoad` runs once at host boot. `onUnload` runs on host shutdown.
`handleCall` services `plugin.call` frames from clients and whatever the
function returns becomes the `data` field of the `plugin.result` reply.
Throw to send back `{ok:false, error: ...}` — errors do not unload the plugin.

> **Tip**: RCC does not ship a `@rcc/plugin-sdk` package yet. Copy the
> `Plugin`, `PluginContext`, and `PluginCallContext` types inline into your
> plugin project to get IDE help. The examples in `examples/plugins/` do this.

---

## PluginContext API (`onLoad`)

```ts
export type PluginContext = {
  id: string;
  log: (msg: string) => void;
  broadcast: (frame: { kind: string; payload?: unknown }) => void;
  onSessionCreated: (cb: (s: SessionMetaLite) => void) => () => void;
  onSessionExited:  (cb: (sid: string) => void)        => () => void;
};

export type SessionMetaLite = {
  id: string;
  cwd: string;
  title?: string;
  status: "running" | "exited";
  projectId?: string;
};
```

- `log(msg)` — writes `[plugin:<id>] <msg>` to the host stdout.
- `broadcast({kind, payload})` — sends a `plugin.broadcast` frame to every
  connected websocket client. `kind` is trimmed to 64 chars; the payload is
  your domain payload (keep it small). Requires `broadcast` permission.
- `onSessionCreated(cb)` / `onSessionExited(cb)` — subscribe to session
  lifecycle. Returns a disposer; the host also cleans up on shutdown.
  Requires `session:read`.

## PluginCallContext (`handleCall`)

```ts
export type PluginCallContext = {
  id: string;
  log: (msg: string) => void;
  hasPermission: (p: PluginPermission) => boolean;
};
```

Use `hasPermission` to branch: if a caller expects you to broadcast but you
weren't granted the permission, return a useful error rather than a silent
no-op.

---

## Permissions

| Permission | What it unlocks |
|---|---|
| `session:read` | `ctx.onSessionCreated` / `ctx.onSessionExited` fire. Without it, subscribe calls return a no-op disposer. |
| `session:write` | Reserved. Future APIs for creating / closing sessions from a plugin. |
| `chat:read` | Reserved. Future APIs for reading session chat history. Today, callers can still pass chat into your plugin via `plugin.call` payload. |
| `broadcast` | `ctx.broadcast` actually emits `plugin.broadcast`. Without it, broadcast calls log a warning and drop the frame. |

Principle of least privilege: only declare what you use. Every permission
shows up as a chip in the Plugins config tab — fewer chips means more user
trust.

---

## UI plugins (iframe)

Set `"ui": "public"` in `manifest.json` and put an `index.html` in that
directory. The RCC config view will show an "Open" button that mounts the
page inside a sandboxed iframe:

```
sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
```

The iframe URL is `/plugins/<id>/?token=<authToken>`. The `token` query
parameter carries the authenticated client's bearer token so the iframe can
open its own websocket to the host:

```ts
const token = new URLSearchParams(location.search).get("token");
const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws?token=${token}`);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    v: 1,
    t: "plugin.call",
    pluginId: "my-plugin",
    method: "ping",
    callId: crypto.randomUUID(),
    payload: {},
  }));
});
```

Alternatively, have the parent window bridge `plugin.call` frames on your
behalf with `window.postMessage`. This avoids re-handshaking a ws and works
when the iframe only needs to nudge the parent RCC client.

UI files are served verbatim. No bundler, no build step required — drop in
HTML / JS / CSS. Pull in libraries via `<script src>` if you need them.

For **pure UI plugins** that store their state client-side (localStorage,
IndexedDB) and never need host APIs, declare `"permissions": []`. See
`examples/plugins/scratchpad`.

---

## Debugging

- **Host stdout**: every `ctx.log(msg)` lands as `[plugin:<id>] <msg>`. Use
  `RCC_DEBUG=1 pnpm dev:host` (or whatever you run the host with) to keep
  the console open.
- **Load errors** are logged at boot and the plugin appears disabled in the
  Plugins config tab with the error message. Invalid manifests, throwing
  `onLoad`, bad `default` exports — none of these crash the host.
- **Call errors** come back as `{ok:false, error: "<message>"}`. Add a
  `ctx.log(...)` before each throw in `handleCall` to track down which
  method blew up.
- **Reload**: plugins are loaded once at boot. Restart the host to reload.
  (Hot-reload is not supported — dynamic import caches the module URL.)

---

## Install & distribute

Today plugins install manually:

```bash
cp -R examples/plugins/hello-world ~/.rcc/plugins/hello-world
# restart host
```

Alternatively, if your plugin's entire source is small enough, ship it via
the Marketplace: a catalog `plugin` entry with `source: { type: "inline",
files: { "manifest.json": "...", "index.ts": "...", ... } }` lets RCC's
Marketplace UI install it into `~/.rcc/plugins/<id>/` after the user
approves the permission list. See `marketplace.ts` for the entry shape.

Tarball-hosted plugins (`source: { type: "tarball", url: "https://..." }`)
are recognised in the protocol but not yet installed automatically.

---

## Best practices

- **Keep `onLoad` short.** It blocks host boot. If you need to warm up
  state, spawn work and return.
- **Never block the event loop.** Offload CPU-bound work; `await` your IO.
- **Catch your own errors.** Unhandled exceptions in subscribed callbacks
  are caught by the host but still noisy. Wrap handlers in `try/catch` and
  `ctx.log` the failure.
- **Bound your broadcasts.** `plugin.broadcast` reaches every connected
  client. Throttle high-frequency events (e.g. git polling) to ≥ 2-second
  intervals.
- **Declare the minimum permissions.** Users see the permission chips when
  deciding whether to trust your plugin.
- **Don't rely on cwd equality.** Session cwd can contain symlinks, trailing
  slashes, or user-home expansion differences; compare with `path.resolve`.
- **Version your payloads.** Include a `v:` field in `handleCall` payloads
  and broadcasts so future callers can negotiate.
- **Write a README.** Even for plugins you use alone, note purpose,
  permissions required, and any environment variables.

---

## Reference: examples

- `examples/plugins/echo-bot/` — minimal `plugin.call` echo + iframe UI.
- `examples/plugins/git-status/` — `session:read` + `broadcast`, polls
  `git status --short` for the active session's cwd and pushes a
  `plugin.broadcast` frame.
- `examples/plugins/standup-note/` — `chat:read` pattern: summarises the
  last N chat lines (passed in via payload) into a one-line progress note.
- `examples/plugins/scratchpad/` — pure iframe UI with localStorage, no
  host permissions.
