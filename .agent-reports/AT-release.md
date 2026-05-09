# AT · Single-binary release

`scripts/build-release.mjs` + `scripts/install.sh`, `pnpm build:release`.

## Build

1. `pnpm -r typecheck` (all green).
2. Emit JS:
   - protocol: temp `tsconfig.build.json` → `packages/protocol/dist/{index.js,index.d.ts}`
   - host: temp `tsconfig.build.json` → `packages/host/dist/*.js` (48 modules)
   - cli: existing `pnpm -F @rcc/cli build`
   - web: `pnpm -F @rcc/web build`
3. Stage `release/rcc-<ver>/{bin,lib}`; `lib/{host,cli,web,protocol}` + minimal `package.json` per.
4. `npm install --omit=dev --install-strategy=hoisted --ignore-scripts` in `lib/` with versions resolved from the workspace's already-installed deps → 138 pkgs.
5. Prune: node-pty cross-platform prebuilds (keep current only), src/deps/third_party, `.d.ts`/`.map`, `CHANGELOG.md`, test/docs dirs.
6. tar.gz + sha256 sidecar + `SHA256SUMS`.

## Actual output (darwin-arm64, v0.1.0)

- Unpacked: **234.3 MB** (of which `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` native is 196 MB — required for SDK driver)
- tar.gz: **66.1 MB** (exceeds 50 MB target; the claude binary dominates — without it we'd be ~10 MB)
- Files: launchers `bin/{rcc,rcc-cli,rcc-admin}` (sh), `lib/host/index.js`, `lib/web/dist/`, `lib/node_modules/` (prod deps only)

## Runtime validation

Extracted to `/tmp/rcc-0.1.0`, ran `./bin/rcc` against fresh `HOME`:
- `/health` → `{"ok":true,...}` 200
- `/` → 200 (web bundle served from `lib/web/dist`)
- `./bin/rcc-cli` → help text OK
- `./bin/rcc-admin list` → `(no paired devices)`

## Platform coverage

Current release only builds current-platform tarball. Script reads `process.platform`/`process.arch`; CI matrix can run it on darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64. node-pty prebuilds ship all four, @anthropic native is per-platform optional dep (npm installs the right one).

## Source change

`packages/host/src/index.ts`: `WEB_DIST` now respects `RCC_WEB_DIST`. Launcher sets it so the release layout decouples from the dev tree. Non-release behavior unchanged.

## Constraints met

- No pkg/bun/SEA.
- No self-update / install-channel files touched.
- `pnpm -r typecheck` green.
- `./bin/rcc` runs from extracted dir with no workspace needed.
- tar excludes `.env`, `.rcc`, caches, logs (only built artifacts + prod deps).
