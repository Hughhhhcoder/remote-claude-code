# AD-palette

Global command palette — Batch 10 / Agent C.

**Web** (`packages/web/src/CommandPalette.tsx`, new): Cmd+K/Ctrl+K toggles a
centered modal (20vh top, max-width 600). Window-level `keydown` listener is
registered with `capture:true` and calls `stopPropagation+preventDefault` so
xterm never sees ⌘K / arrows / Enter / Esc while the palette is open.

Items aggregate six categories: actions, sessions, slash commands, skills,
subagents, and fixed git read-only shortcuts. Prefixes `>` `:` `@` `#`
restrict to actions / commands / sessions / skills. A hand-rolled `score()`
weighs exact, prefix, substring, and longest consecutive-run matches.

`createEffect` on `open()` triggers a one-shot fetch (`skill.list.request`,
`cmd.list.request`, `subagent.list.request`) with a 60s cache, and focuses
the input. Skills run as `请使用 skill: <name>` to active sid, commands as
`/<name>\r`, subagents as `@<name> ` chat mention, git as `git.exec.request`.

**App.tsx**: adds `paletteActions` memo wiring 8 host callbacks (new session,
config, marketplace, settings, file browser, projects, devices, new project),
and mounts `<CommandPalette>` next to existing modals.

`pnpm -r typecheck` green across protocol / host / web.
