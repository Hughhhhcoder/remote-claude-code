# Batch 4 · K · Web Push

**Status:** 🟢 done — 2026-05-09

## Changes

- **protocol**: `[push]` block with six frames: `push.public-key.request` → `push.public-key`, `push.subscribe` → `push.subscribed`, `push.unsubscribe` → `push.unsubscribed`, `push.test`. Appended to discriminatedUnion.
- **host/push.ts** (new): `PushService` loads/persists VAPID keypair in `~/.rcc/config.json` (preserves other keys; 0600), stores subs in `~/.rcc/push-subs.json` (0600). `sendOne()` auto-prunes 404/410. `broadcast("all" | deviceIds[], payload)` fans out via `Promise.allSettled`. `revokeDevice()` drops subs on device revoke.
- **host/index.ts**: init `PushService.load()` at boot; handlers for the four client frames; `broadcastApproval` fires push only on `risk === "high"` with tag `approval-<id>` and `requireInteraction: true`; `attachApprovalWatcher` exit callback fires "✓ 会话已结束" push tagged `session-exit-<sid>`; `device.revoke` also runs `push.revokeDevice()`.
- **web/public/sw.js**: appended `push` + `notificationclick` listeners (focus existing tab or openWindow("/")). Existing fetch/install/activate untouched.
- **web/src/push.ts** (new): `enablePush` / `disablePush` / `getPushStatus` / `sendTestPush` — permission → VAPID fetch → pushManager.subscribe → send `push.subscribe`. Handles stale sub with mismatched VAPID key.
- **web/src/PushPrompt.tsx** (new): 🔔 bell in top bar. Off=grey, on=orange w/ dropdown [测试] [关闭], denied/unsupported=faded + tooltip.
- **FEATURES.md**: M3 Push row 🟢 + changelog.

## Verified

- `pnpm -r typecheck` green
- `pnpm -F @rcc/web build` green
- VAPID private key never sent to client; only `getPublicKey()` exposed.
