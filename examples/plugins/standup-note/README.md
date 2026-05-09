# standup-note — RCC Plugin Example

Reads recent chat from a session and returns a one-line "today's progress"
summary. Demonstrates the `chat:read` pattern: a caller (UI / CLI) that has
access to chat passes lines into the plugin via `plugin.call` payload, and
the plugin produces a human-friendly digest.

> The `chat:read` permission is declared in anticipation of a future
> `ctx.readChat(sid, n)` host API. Today the plugin accepts chat lines
> directly from the caller, who is responsible for reading them.

## Install

```bash
cp -R examples/plugins/standup-note ~/.rcc/plugins/standup-note
# restart host
```

## Permissions

- `chat:read` — reserved for future direct-read API
- `broadcast` — lets the plugin push the summary to all clients (not used
  by default; declared so the summary can optionally be re-broadcast)

## Methods

### `summarize`

Payload:

```ts
{
  sid?: string;
  lines: Array<{ role: "user" | "assistant" | "system"; text: string; at?: number }>;
  limit?: number; // default 10, max 50
}
```

Returns:

```ts
{
  sid: string | null;
  considered: number;
  summary: string;           // "今日进展:..."
  generatedAt: number;
}
```

### `help`

Returns method metadata — useful for introspection from a plugin host UI.

## Example

```json
{"v":1,"t":"plugin.call","pluginId":"standup-note","method":"summarize","callId":"s1",
 "payload":{"lines":[
   {"role":"user","text":"fix login bug in oauth flow"},
   {"role":"assistant","text":"Patched the callback handler; tests green."}
 ]}}
```
