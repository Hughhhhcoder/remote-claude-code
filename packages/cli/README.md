# @rcc/cli — `rcc` standalone REST client

Command-line client for an [RCC host](../host). Talks to the Batch 14 REST API (`/api/v1/*`) with a Bearer token; no WebSocket, no Web UI dependency.

## Install

The CLI lives inside the monorepo as a workspace package. From the repo root:

```sh
pnpm -F @rcc/cli build
# then link dist/index.js wherever you want rcc on $PATH, e.g.:
ln -s "$(pwd)/packages/cli/dist/index.js" ~/.local/bin/rcc
```

For development, `pnpm -F @rcc/cli start -- <args>` runs the TypeScript source through `tsx`.

## Login

Two ways to populate `~/.rcc/cli-config.json` (mode 0600, under `~/.rcc/`):

```sh
# Direct token (e.g. exported from web localStorage, or issued by the host)
rcc login --url https://home.example.com --token <device-token>

# Pairing code flow (two-step — ask the host to `POST /pair/new` first)
curl -s -X POST https://home.example.com/pair/new
# → { "code": "123456", "claimSecret": "abc..." }
rcc login --url https://home.example.com \
  --pair-code 123456 --claim-secret abc... \
  --device-name "my-laptop"
```

`login` validates the token via `GET /api/v1/health` before writing. Multiple profiles are supported via `--profile <name>`; the first profile becomes `defaultProfile`.

## Commands

All commands accept `--profile <name>` (pick an alternate profile) and `--json` (emit raw JSON instead of formatted tables).

| Command | REST endpoint |
|---|---|
| `rcc sessions list` | `GET /api/v1/sessions` |
| `rcc sessions new [--cwd <p>] [--mode <m>] [--starter <id>] [--driver cli\|sdk] [--project <id>]` | `POST /api/v1/sessions` |
| `rcc sessions show <sid>` | `GET /api/v1/sessions/:sid` |
| `rcc sessions close <sid>` | `DELETE /api/v1/sessions/:sid` |
| `rcc sessions resume <sid>` | `POST /api/v1/sessions/:sid/resume` |
| `rcc prompt <sid> "<text>"` | `POST /api/v1/sessions/:sid/prompt` |
| `rcc chat <sid>` | `GET /api/v1/sessions/:sid/chat` (colorized by role / segment kind) |
| `rcc share <sid> [--ttl <minutes>]` | `POST /share/new` |
| `rcc devices [list\|revoke <id>\|rename <id> <name>]` | `/api/v1/devices*` (may 404 on older hosts; fallback: `pnpm -F @rcc/host admin ...`) |
| `rcc projects [list\|add --name <n> --cwd <p>\|remove <id>]` | `/api/v1/projects*` |
| `rcc version` | local package.json + `GET /version`, side-by-side match/mismatch |

Examples:

```sh
rcc sessions list
rcc sessions new --cwd "$PWD" --mode acceptEdits
rcc prompt s_abc "write a unit test for Foo"
rcc chat s_abc
rcc share s_abc --ttl 30
rcc version --json
```

## Config

`~/.rcc/cli-config.json` (mode 0600):

```json
{
  "defaultProfile": "home",
  "profiles": {
    "home": { "url": "https://home.example.com", "token": "dt_…" },
    "staging": { "url": "https://rcc.staging", "token": "dt_…" }
  }
}
```

Tokens are never printed to stdout. `HttpError` carries only `error` + `code` from the server response.

## Exit codes

- `0` — success
- `1` — runtime/network/API error (formatted to stderr, red)
- `2` — usage / argument error
