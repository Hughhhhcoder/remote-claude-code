# AN · Plugin SDK

## What landed

- **Protocol** (`packages/protocol/src/index.ts`): `PluginInfo` + 5 new frames
  (`plugin.list.request`, `plugin.list`, `plugin.call`, `plugin.result`,
  `plugin.broadcast`). Plugin-defined methods ride `plugin.call`'s `method` /
  `payload` fields so the zod discriminated-union never grows per-plugin.
- **Host** (`packages/host/src/plugins.ts` new, `index.ts` wired): `PluginHost`
  scans `~/.rcc/plugins/<id>/manifest.json`, dynamic-imports the entry, stores
  Plugin instance. `onLoad(ctx)` hands out permission-gated APIs
  (`log`/`broadcast`/`onSessionCreated`/`onSessionExited`). `plugin.call` →
  `handleCall(method, payload, ctx)`; errors become `ok:false` results. Import
  / manifest / onLoad failures log + mark plugin disabled but don't abort host
  startup. Session creation sites call `notifyPluginSessionCreated(s)`.
- **HTTP** route `GET /plugins/:id/*` authenticated; serves `<plugin>/public/*`
  with traversal-proof `resolveUiAsset` and `nosniff`. Token passed via
  `?token=` on URL so iframes work.
- **Web** `PluginsTab.tsx` (ConfigView tab 10): lists plugins with permissions
  chips + error strings; "打开" opens sandboxed iframe modal.
- **Example** `examples/plugins/echo-bot/` (manifest + index.ts + public +
  README).

## Security caveat

Plugins run **inside the host Node process**. They inherit full fs / network
/ child-process access. Permissions are a _capability surface_ (gating
`ctx.broadcast` + session event subscriptions), not a sandbox. The README
calls this out; the Plugins tab shows chips so users can inspect scope before
trusting. No `vm` or iframe-for-code sandbox was added, per spec. `plugin.call`
payloads are capped at 256KB.

## Verify

`pnpm -r typecheck` green across protocol / host / web.
