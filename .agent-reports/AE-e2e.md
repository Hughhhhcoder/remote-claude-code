# AE — E2E Tests

Landed first test suite for RCC. Playwright 1.59 headless chromium,
`pnpm test:e2e` builds the web bundle then runs 5 specs (~4s) against a
throwaway host spawned on :7799 with an isolated HOME (mkdtemp) and a
fake-claude.mjs echo CLI so node-pty streams are real but deterministic.

Coverage:
- smoke: web loads, "connected" status, bootstrap session in sidebar.
- commands: Ctrl+K opens palette, searching "新建" + Enter opens
  NewSessionModal; Esc toggles closed.
- share: grabs active sid via a short-lived ws hello, POSTs /share/new,
  opens the returned URL in a fresh browser context, asserts 只读分享
  badge.

Not covered (intentional): the pairing flow — it requires a human to
read the 6-digit code printed to host stdout; the test harness trusts
loopback (RCC_TRUST_LOOPBACK=1) and skips it. WebAuthn, tunnels,
recording playback, marketplace network calls are also out of scope
for the smoke tier.

One yak-shave: libsodium-wrappers fails its keypair generation on
Node 25 CJS interop; the fixture pre-seeds ~/.rcc/keys.json inside the
isolated HOME so loadOrCreateHostKeys() never hits the broken path.
Loopback connections don't exercise E2E crypto so the placeholder keys
are never actually used — they only pass the "file-exists" gate.

pnpm -r typecheck still green (e2e uses its own tsconfig, not a workspace).
