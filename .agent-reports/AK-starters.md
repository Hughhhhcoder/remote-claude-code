# AK — Session Starter Kits

Batch 13 Agent A: "Starter Kit" one-click session bootstrap.

## 设计
- `Starter = { id, name, systemPrompt?, enableSkills?, firstSteps?, permissionMode?, icon?, color?, createdAt, builtin? }`
- 3 hardcoded builtin seeds: `builtin:code-review`, `builtin:debug`, `builtin:plan`
- User-defined starters at `~/.rcc/starters.json` (0600, atomic rename, 32KB cap, 50 steps cap); id prefix `user:`
- Builtins cannot be deleted/edited but can be duplicated into a user starter (UI drops id at save time).

## Host (zero execution)
- `packages/host/src/starters.ts` — `StarterStore` with CRUD + in-memory seeds merged into `list()`.
- `packages/host/src/index.ts` — 3 handlers (`starter.list.request` / `starter.save` / `starter.remove`) mutation-broadcast `starter.list`.
- Host does NOT enable skills / inject prompts / run steps. `session.new.starterId` flows through to the session but orchestration is client-side.

## Protocol
- `Starter` + 6 frames (`starter.list(.request)` / `starter.save(d)` / `starter.remove(d)`) added after notebooks block.
- `SessionNew.starterId` optional field.

## Web
- `StartersTab.tsx` = ConfigView's 9th tab (indigo/violet accent). Builtins render with 🔒 + "复制为用户版" (⎘) action. User entries editable/deletable. Editor modal reuses WorkflowStep UI for firstSteps.
- `NewSessionModal` gets a Starter `<select>` at the top; selecting one auto-switches the permissionMode picker and shows a description + chip summary panel.
- `App.tsx` adds `starters` + `pendingStarterId` signals; on `session.created` it calls `runStarterBootstrap(sid, starter)` which `setTimeout(300ms)` then:
  1. `skill.toggle { enabled: true }` for each id
  2. `client.write(sid, systemPrompt + "\r")` (CLI pty.in or SDK write — same path)
  3. `workflowRunner.start({ workflow: { steps: firstSteps } })` reusing the existing runner

## FEATURES.md
- M6 table row added.
- Changelog entry appended after the 13 B Usage row.

## Constraints honored
- Did not touch `usage.ts`, `federation.ts`, peer/usage frames, `session.ts`.
- `pnpm -r typecheck` green across protocol / host / web.
