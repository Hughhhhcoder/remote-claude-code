# AR-cli — Batch 15 Agent B

Built `packages/cli/` workspace, a standalone REST client `rcc`. No new deps: hand-rolled argv parser + ANSI colour + built-in `fetch`. TS compiled via tsc NodeNext with `rewriteRelativeImportExtensions` so source keeps `.ts` imports while `dist/index.js` emits `.js`.

Commands: `login` (token direct or `/pair/claim`), `sessions list|new|show|close|resume`, `prompt`, `chat` (role + segment-kind colouring), `share`, `devices` (with 404 fallback hint), `projects`, `version` (local vs `GET /version`). Global `--profile`, `--json`, `--help`.

Config `~/.rcc/cli-config.json` 0600 + atomic tmp→rename; token never printed; exit codes 0/1/2. README in package. FEATURES.md M8 row + changelog updated. `pnpm -F @rcc/cli build` + typecheck green; protocol + host typecheck green; pre-existing web i18n failure not touched.
