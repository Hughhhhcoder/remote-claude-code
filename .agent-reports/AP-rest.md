# AP · REST API + OpenAPI (Batch 14 C)

## Deliverables

- `packages/host/src/rest.ts` — new. `handleRestRoute(req,res,ctx)` dispatches
  `/api/v1/*` across sessions / projects / skills / mcp / commands / subagents
  / hooks / permissions / starters. Methods: GET list + POST create + DELETE /
  PUT where it makes sense. Session convenience endpoints: `/input` (raw
  bytes), `/prompt` (appends `\r`), `/resume` (archive → live swap via
  injected `resumeArchivedSession` callback), `/chat` (messages). 1MB JSON
  body cap, all responses `application/json;charset=utf-8`, unified error
  shape `{error, code}`. Bearer auth via host `authenticate` except
  `/api/v1/health`.
- `packages/host/src/openapi.ts` — static OpenAPI 3.1 JSON (hand-authored)
  covering every endpoint, `bearerAuth` security scheme, `SessionMeta` and
  `Error` schemas. Served at `GET /api/openapi.json`.
- `packages/host/src/index.ts` — imports `handleRestRoute`, dispatches after
  the pair route, and adds `buildRestCtx()` that threads registry / stores /
  wiring callbacks without re-exporting internals. Resume callback reuses the
  exact archive→live path from the ws handler.
- `tests/e2e/specs/rest.spec.ts` — six cases: health (no auth), openapi shape,
  session list, session create+list+delete round-trip, projects list, 404
  JSON shape.
- `FEATURES.md` — new M8 row and changelog entry.

## Notes

- REST reuses existing service layer (no duplicated business logic).
- Audit log hookup was left to Agent B per Batch 14 plan; REST does not call
  `audit.write` directly.
- `pnpm -r typecheck` clean.
