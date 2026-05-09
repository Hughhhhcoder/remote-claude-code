# git-status — RCC Plugin Example

Polls `git status --short` for every running session's working directory and
broadcasts a `plugin.broadcast { kind: "git.status.ext" }` frame to every
connected client. Demonstrates how to extend RCC with session-scoped
background work without modifying core code.

## Install

```bash
cp -R examples/plugins/git-status ~/.rcc/plugins/git-status
# restart host
```

## Permissions

- `session:read` — subscribe to session created / exited
- `broadcast` — emit `plugin.broadcast` frames

## Methods

- `plugin.call { method: "refresh" }` — force a refresh of every session
- `plugin.call { method: "refresh", payload: { sid } }` — refresh one session
- `plugin.call { method: "list" }` — return the sessions the plugin tracks

## Broadcast shape

```ts
{
  v: 1,
  t: "plugin.broadcast",
  pluginId: "git-status",
  kind: "git.status.ext",
  payload: {
    v: 1,
    sid: "...",
    cwd: "...",
    clean: boolean,
    entries: Array<{ code: string; file: string }>,
    at: number,
    error?: string
  }
}
```

Clients can render a "dirty files" badge on the session tile by listening
for `plugin.broadcast` frames with `pluginId === "git-status"`.
