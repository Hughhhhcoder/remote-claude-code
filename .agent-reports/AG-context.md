# AG-context

跨 session 上下文共享 — Batch 11 / Agent C.

**Web** (`packages/web/src/ContextInjector.tsx`, new): Two-step modal. Step 1
lists other sessions (excluding current) with summary.title fallback title,
driver chip, archived indicator. Step 2 fires `chat.list.request` for the
chosen sid, previews a normalised prompt, offers 10/30/50/all count presets.
`segmentToText` maps all 6 ChatSegment kinds to plain text; final form is
`以下是来自会话 "<title>" 的上下文:\n\n[role] ...\n\n请基于以上上下文继续协助。`.
TextEncoder-measured UTF-8 byte count hard-capped at 32 KB — larger prompts
disable the confirm button and surface a red warning banner.

Confirm invokes `client.write(activeSid, prompt + "\r")` — CLI pty.in path
and SDK write-queue path both accept it, no protocol changes.

**ChatView**: adds optional `sessions?: SessionMeta[]` prop, 📋 button in
the input rail next to 🎙 / 发送, mounts ContextInjector on demand. App.tsx
passes `sessions()`.

`pnpm -F @rcc/web typecheck` green (host workflows.ts pre-existing error
untouched — out of scope).
