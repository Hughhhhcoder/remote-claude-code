## AI summary + cross-session search

host/summary.ts + host/search.ts delivered by the stalled Agent C; integration (frame handlers, boot rebuild, chat.onMessage tap, session.exit trigger, FEATURES row, web UI) completed by the integrator after 524 timeout.

### Summary
- `summarizeSession({sid, chat})` → calls Anthropic `/v1/messages` with `claude-haiku-4-5`, recent 50 chat messages, 300 max_tokens; on missing apiKey or API failure, falls back to heuristic (first user message trimmed to 60 chars for title, up to 3 user msgs as bullets).
- Triggered on `session.onExit` and `summary.refresh` frame.
- Cached in `sessionSummaries: Map<sid, SessionSummary>` and merged into `session.meta().summary` when broadcasting.

### Search
- `SearchIndex` with `index: Map<token, Set<sid>>` + `sessionBodies: Map<sid, string>` + per-sid token set.
- AND semantics: all query terms must hit same sid; score = hit count on body; top 30 matches; 3 excerpts/sid, 200 chars each.
- Rebuilt from persisted snapshots at boot; updated incrementally via `chat.onMessage` tap in `attachChatBroadcast`.

### Limits
- Index is pure memory — 200+ sessions with 100 msgs each should stay under 50MB.
- No stemming / multilingual tokenization — CJK chars tokenize as single-char sequences (works OK for exact-substring queries).
- Anthropic call blocks 30s max with AbortController; no retry. Heuristic fallback keeps the feature usable offline.

### Web
- Sidebar search input → `search.request` per keystroke (no debounce yet, small cost per match); results render above sessions list; click jumps to that sid.
- SessionRow title uses `summary.title ?? meta.title ?? meta.id`; bullets shown via `title` attribute (native tooltip).
