# Echo Bot — RCC Plugin Example

A minimal RCC plugin that echoes payloads back via `plugin.call`.

## Install

```bash
cp -R examples/plugins/echo-bot ~/.rcc/plugins/echo-bot
```

Restart the RCC host. On boot you should see:

```
[plugins] loaded echo-bot@1.0.0
[plugin:echo-bot] echo-bot loaded
```

## Test

From the web UI: open Config → Plugins, the plugin should appear with a
`broadcast` and `session:read` permission chip and an "打开" button to open
the UI in a sandboxed iframe.

From a script, send over the ws:

```json
{"v":1,"t":"plugin.call","pluginId":"echo-bot","method":"echo","callId":"x1","payload":{"msg":"hi"}}
```

Expected reply:

```json
{"v":1,"t":"plugin.result","callId":"x1","pluginId":"echo-bot","ok":true,"data":{"echoed":{"msg":"hi"},"at":...}}
```

## Layout

```
echo-bot/
  manifest.json    { id, name, version, entry, ui?, permissions? }
  index.ts         default export: Plugin object
  public/          static UI files served at /plugins/echo-bot/*
    index.html
```

## Permissions

`manifest.json.permissions` selects what the plugin context exposes:

- `session:read` — subscribe to session created / exited events
- `session:write` — reserved for future write APIs
- `chat:read` — reserved for future chat inspection APIs
- `broadcast` — call `ctx.broadcast({kind, payload})` to push `plugin.broadcast`
  frames to every connected client

No permission = minimum-privilege (the plugin can still handle `plugin.call`
but has no context side-channels).

## Trust boundary

Plugins run inside the host's Node process. They have full filesystem and
network access. Only install plugins you trust — the protocol offers no
sandboxing beyond the declared permission chips.
