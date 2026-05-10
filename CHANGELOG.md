# Changelog

All notable changes to RCC. The v0.2 "Claude UX" arc spanned batches 1–34 across Phases 1–23 (design lock → full frontend rewrite → release). Dates in ISO, tags where released.

---

## Unreleased — toward v1.0.0

- Batch 34 (Phase 23 · v1.0 cleanup / release prep): top-level README rewrite + this changelog.
- Earlier Phase 16–17 tags still pending: `v0.1.17` (observability), `v0.1.18` (docs site), `v0.1.19` (release infra).

## v0.1.15-rc — Mobile native feel (Phase 21, batches 28–30)

### Chat export and search (batch 28)

- **B28-A** `exportChat.ts` — Markdown (with folded thinking / tool_use / diff fences), JSON (`ChatExportJson v1`), print-to-PDF with dedicated `@media print` stylesheet hiding chrome and unfolding scroll containers. Header menu via Popover (desktop) / bottom sheet (mobile).
- **B28-B** Offline static HTML export — self-contained, no host needed to read.
- **B28-C** Search in-session — `searchStore.jumpTo(sid, messageId?)`, `scrollIntoView` + 2 s `flash-message` accent keyframes, sticky N/M navigator overlay with prev/next.

### Mobile polish (batch 29)

- **B29-A** Pinch-zoom code blocks (12–20 px clamp, pointer-only so desktop unaffected), pull-to-refresh sessions sidebar with rubberband + rAF-tracked offset.
- **B29-B** Haptic feedback (`useHaptics` hook, Web Vibration API) on composer send / approval decide / long-press / workflow step; opt-out toggle. iOS safe-area deep polish — new utility classes `safe-area-padding-*` across TopBar, Toast, bottom sheets.
- **B29-C** Custom key toolbar reordering + 21 preset escape sequences; PWA `shortcuts` manifest entries for New Session and Inbox.

### Passkey high-risk gate (batch 30)

- **B30-A** `bypassPermissions` toggle and device revoke now gated by WebAuthn when a passkey is registered; typed warning `confirm()` fallback. Reuses existing `/webauthn/assert/*` endpoints — zero host/protocol change.

## v0.1.13 — Session UX depth (Phase 12, batches 23–25)

### Session lifecycle (batch 23)

- **B23-A** `session.fork { sid, uptoMessageId }` — slice chat up to a message, inherit driver / cwd / permissionMode / projectId, audit entry, auto-focus. Fork button in message hover action bar.
- **B23-B** Pin / archive / tag / search — `session.meta.set` partial update frame; sidebar star prefix, archived toggle, tag chips (dedupe, 16 cap), hydration across host restarts.
- **B23-C** Session rename + auto-title — `deriveAutoTitle()` from first user message (word-boundary, 50 char trim, punctuation strip), double-click inline edit, `null` resets to cwd.
- **B23-D** Mobile 4-tab router — `shell/MobileTabRouter.tsx` dispatches chat / files / approvals / settings; NewSessionModal footer sticky + safe-area + `svh`.

### Context (batch 24)

- **B24-A** `ContextInjector.tsx` full rewrite (257 → 510 LOC): Claude-warm palette, keyboard nav, byte budget with warn at 75 % / danger at 32 KB.
- **B24-B** `@mention` — popover (desktop) / bottom sheet (mobile), sessions from local store + files via debounced `fs.ls.request`, inserts `@session:<sid>` or `@file:<relpath>` tokens.
- **B24-C** Project-level system prompt (up to 4000 chars) — NewProjectModal + ProjectsModal textareas, auto-injected at session create when no starter overrides.

### Starters and workflows (batch 25)

- **B25-A** Starters redesign — card grid, inline preview of systemPrompt + skills + first steps.
- **B25-B** Workflow runner — step-visualized panel (mobile bottom sheet), live elapsed, stop / skip / retry / resume-from-step / restart, 17 `workflow.*` i18n keys.
- **B25-C** Workflow conditions + variables — `{{name}}` / `{{env:VAR}}` interpolation, `==` / `!=` / `contains` / `!contains` ops on quoted/bare literals, no JS eval.

## v0.1.12 — PWA + push closure (Phase 11, batches 21–22)

- **B21-A** SW version banner + click-to-update.
- **B21-B** Background sync → local notifications for new messages.
- **B21-C** Share target — `manifest.share_target` + `/share` handler, prepends to CRDT draft via `createSharedText`, creates NewSessionModal when no active sid.
- **B22-A** `PushSettingsPane` — per-device subscribe / unsubscribe / test, endpoint fingerprint.
- **B22-B** High-risk approvals push to locked screen — 5 s debounce buffer (single vs aggregated payload), online-device filter, `tag=approval.id`, `data.url=/#inbox`.
- **B22-C** Quiet hours — `push.preferences.set` with per-subscription `{startHour, endHour, timezone}`, `Intl.DateTimeFormat` tz-aware, cross-midnight, default from `resolvedOptions().timeZone`.

## v0.1.11 — Performance + bundle (Phase 10, batches 18–20)

- **B18-A** Monaco + xterm fully lazy — initial chunk 529 KB → 440 KB, HTML no longer modulepreloads heavy vendor.
- **B19-A** WS frame batching — `queueMicrotask` + Solid `batch()`, hello burst coalesced into one render.
- **B19-B** Sidebar rerender discipline — per-project / per-peer `createMemo`, `SessionRow` flags memoized.
- **B19-C** `visualViewport` rAF throttled.
- **B20-A** Brotli + gzip precompress on build (zlib, q=11 / 9), cache-control strategy per asset type: hashed assets immutable 1 y, index.html no-cache, others 1 h.
- **B20-B** SW precache tightened — shell 122 KB only, heavy chunks SWR with 20-item cap, `__BUILD_VERSION__` placeholder injected from sha256 of output names, activates purge old buckets, `updateViaCache:"none"`.
- **B20-C** Offline hydrate — `useOfflineHydrate` with debounced persist, QuotaExceeded LRU eviction, `ConnectionBanner` shows "🔌 离线模式" badge.

## v0.1.10 — Accessibility and keyboard (Phase 9, batches 16–17)

- **B16-A** WCAG AA across 14 primitives — Dialog `aria-labelledby`, Popover aria-modal on bottom sheet, Toast danger `role="alert"`, AppShell skip-link.
- **B16-C** High-contrast mode — `[data-theme-contrast="high"]` CSS overrides, `prefers-contrast: more` auto-follow, persisted as `rcc.theme.contrast`. Muted text 2.91 → 6.26, accent 2.95 → 6.42.
- **B17-A** Global shortcuts — `useKeyboardShortcuts` registry + chord timeout, help overlay (`?`), `g s` / `g i` / `g c` / `g p` / `c n` / `c p` / `/`.
- **B17-B** Composer shortcuts — Cmd+↑ recall last user text (only when draft empty), Cmd+/ toggle chat/terminal view, platform-aware modifier.
- **B17-C** Focus hygiene — `useFocusTrap` inside Dialog, `useLandmarkCycle` on F6 / Shift+F6, Escape → composer when no dialog open.

## v0.1.9 — Resilience (Phase 8, batches 14–15)

- **B14-C** Reconnect replay on the client — `ChatSinceResolver` per sid, `chat.replay` handler with `lostCount` branching (drop pending + refetch on overflow, else re-dispatch per frame), resolver registry survives ws bounce.
- **B15-A** Optimistic rollback — `pendingCloses` and `pendingResponses` maps with 10 s timers, `error` frame sid-match rollback, toast notifications. New `primitives/Toast.tsx`.
- **B15-B** CRDT collaboration hint — `lastLocalValue` diff in Y.Text observer flashes "👥 协作者正在编辑…" chip, accent ring on composer.
- **B15-C** Clock drift / ring overflow — `ChatReplay.oldestSeq?`, toast "会话快照回放窗口溢出 · 已重新加载" then `chat.list.request` refetch.

## v0.1.8 — CLI session real chat (Phase 7, batches 11–13)

- **B11-A** `chat-parser.ts` v2 — 6-state machine (`IDLE / TEXT / CODE_FENCE / DIFF_BLOCK / TOOL_USE / BOX_PANEL`), tool_use embeds inline, 50 ms debounce flush + 1.5 s idle auto-close.
- **B11-B** New `chat.delta { messageId, segmentIndex, textDelta }` protocol frame — additive, backward compatible.
- **B11-C** Host broadcasts deltas via `attachChatBroadcast`, share whitelist updated.
- **B12-A** Client consumes `chat.delta` — per-segment `PendingEntry { override, textAccum }`, update-wins semantics, orphan-drain handles update+delta folding.
- **B12-B** CLI composer behavior — destructive slash commands (`/clear` `/resume` `/reset` `/exit`) confirm-gated, `ChatSurface.onSend` routes to `App.sendCommand` so `/git:status` hits `git.exec.request` not pty.
- **B12-C** Block-level collapse — TextBlock 20, CodeBlock 30, DiffBlock 40 line thresholds with 16/24/32 head + fade mask + "展开全部 (共 M 行)" button (44 px mobile).
- **B13-B** Host-side chat frame ring buffer — 500-entry `recentChatFrames` per Session, `nextChatFrameSeq()` / `replayChatFrames(since)`, `session.attach.chatSince`, dead-session no-op compat.
- **B13-C** Heavy-message virtualization — `estimateMessageSize`, 64 KB threshold placeholder `[折叠] 历史消息 · N bytes`, expand set, scroll-anchor preserves scroll position on "show earlier".

## v0.1.7 — Panes + first cleanup (Phases 5–6, batches 7–10)

### Feature panes (batches 7–9)

- **B5-A/B/C** Approval / Inbox / Devices / Peers panes — Face ID gate via `authenticateForApproval`, filter chips, `peer.list/add/remove` wire.
- **B5-D/E/F** File browser + Monaco preview (lazy ≥ 1 MB/base64 fallback), Notebook with real chatRef resolution, Recording (record.start/stop + HTTP `GET /recording/<sid>.cast`, xterm lazy playback 0.5x–4x).
- **B5-G–J** Settings pane unified (10 lazy tabs) + Marketplace (skill / mcp / plugin categories, install scope picker).

### Cleanup (batch 10)

- **B10-A** Delete legacy `packages/web/src/mobile/` and `MobileKeyBar`, inline `MobileTab` type into `uiStore`. `ChatView.tsx` and `useIsMobile.ts` kept temporarily (removed in Phase 16/B33-A-cleanup).
- **B10-B** `PairingView` rewrite — 6-digit grid, auto-advance, paste-split, `motion-safe` Tailwind variant, 44 px+ touch.
- **B10-C** `CommandPalette` visual upgrade — serif search, `⌘+K` / `Ctrl+K` platform-aware kbd hint, mobile bottom sheet.

## v0.1.6 — Chat surface rewrite (Phase 4, batches 4–6)

### Rendering (batch 4)

- **P4-A** `ChatPane` + `ChatHeader` — three-slot container, 760 px centered max-width, `ChatPaneContext` for autoscroll.
- **P4-B** `MessageList` — autoscroll with 32 px threshold pill, lightweight virtualization (≤200 all / >200 window, "显示更早消息" button).
- **P4-C** `MessageRow` — system / user / assistant branches, diamond avatar, `isFollowup` collapse, desktop hover action bar.
- **P4-D** `TextBlock` (hand markdown, JSX-only, URL whitelist) + `CodeBlock` (built-in tokenizer for ts/tsx/js/jsx/json/py/go/rs/sh).

### Rich content + streaming (batch 5)

- **P4-E** `DiffBlock` — unified diff hand-parser, +N/-M chips, path chip, Claude-warm tonal highlight.
- **P4-F** `ToolCallBlock` — paired tool_use + tool_result with status pill, 240 px scroll areas, per-`<pre>` copy chip.
- **P4-G** `ApprovalBlock` inline card — risk color, Face ID chip on high-risk, 44 px button height.
- **P4-H** `streaming.ts` — rAF-coalesced `chat.update` flush, per-sid filtering, orphan-update parking, final-message merge.

### Composer (batch 6)

- **P4-I** `Composer` — rounded-xl pill, 8-line auto-grow, IME-safe Enter handling, Cmd+Enter force send, Escape blur.
- **P4-J** `SlashPalette` — popover / bottom sheet, window-level capture keydown, prefix + substring filtering.
- **P4-K** `VoiceButton` + `AttachButton`, `startDictation` wrapper with cleanup.

## v0.1.5 — Store split (Phase 3, batch 3)

- **P3-A** `sessionsStore` + `projectsStore` + `peersStore`.
- **P3-B** `uiStore` + `inboxStore` + `prefsStore` (migrations).
- **P3-C** `App.tsx` 1525 → 451 LOC, `MainPane.tsx` extracted (375 LOC) to carry the desktop grid + chips.

## v0.1.4 — Responsive shell (Phase 2, batch 2)

- **P2-A** `AppShell.tsx` + `useMediaQuery` — container-queries-first, grid on large, stacked on small.
- **P2-B** `Sidebar.tsx` (desktop + drawer in one component) + `SessionRow` + `ProjectHeader`.
- **P2-C** `TopBar.tsx` + `TabNav.tsx` + `MobileDrawer.tsx`.

## v0.1.3 — Design lock + primitives (Phase 1, batch 1)

- **P1-A–E** Token lock, CSS vars, Tailwind config, primitives (`Button`, `IconButton`, `TextInput`, `Textarea`, `Toggle`, `Chip`, `Dialog`, `Popover`, `Toast`, `Spinner`).
- Color palette: `#eeece2` light / `#1a1816` dark, `#da7756` accent, Charter serif body, Inter chrome, JetBrains Mono code.
- Motion: 150 ms cubic-bezier(0.4, 0, 0.2, 1), `prefers-reduced-motion` → 0 ms.

---

## Historical arcs

- **v0.1.0–v0.1.2** (prior arc): CLI + SDK drivers, pairing + E2E, pane modals, initial PWA. See `git tag v0.1.2` for the legacy feature matrix.
