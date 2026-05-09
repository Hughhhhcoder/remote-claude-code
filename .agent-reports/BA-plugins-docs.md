# BA-plugins-docs (Batch 18 B)

Wrote `docs/plugin-authoring.md`: Hello World, manifest table, Plugin
interface + PluginContext/PluginCallContext types, 4-permission semantics
table, iframe + token URL UI section, debugging notes, install paths
(manual cp + Marketplace inline), 8 best practices. SDK types left inline
(doc tells authors to copy-paste).

Added three `examples/plugins/*` (manifest + index.ts + README each):

- `git-status` — session:read + broadcast; 15s `git status --short` poll,
  emits `plugin.broadcast kind:"git.status.ext"`; methods refresh/list.
- `standup-note` — chat:read + broadcast; `summarize` method digests
  payload-supplied chat lines into "今日进展:..." note (8 verb hints).
- `scratchpad` — no permissions; pure iframe + localStorage scoped by sid,
  receives sid via postMessage.

FEATURES.md M10 row added + changelog entry. `pnpm -r typecheck` green.
