# R · WebAuthn Passkey

M5 batch 2 · 叠加式二次确认，token 仍是主通路。

## 变更

- **protocol**: `Hello.device` 加 `hasPasskey?: boolean`;`ApprovalResponse` 加 `webauthnToken?: string`。
- **host/trust.ts**: `PairedDevice.passkey?{credId,publicKey,counter,registeredAt}` + `addPasskey/clearPasskey/updatePasskeyCounter`。
- **host/webauthn.ts** (新): `WebAuthnService` 包 `@simplewebauthn/server` 四方法,内存 Map 存挑战(5min TTL)+ `approvalGates` Map 按 approvalId 做门禁;`rpIdFromHost`(Host 头派生,带端口/IPv6 处理)+ `originFromReq`。
- **host/index.ts**: `POST /webauthn/register/{begin,complete}` / `assert/{begin,complete}` / `clear`(鉴权必须带 device token);`approval.response` 走 `consumeGate` — gate 未开则 error+强制 n;`attachApprovalWatcher` 回调里只有当前存在连接设备有 passkey 才 `requireGate`;hello 回填 `hasPasskey`。
- **host/approvals.ts**: 加 `onGate(id,risk)` 回调。
- **web/webauthn.ts** (新): `registerPasskey/clearPasskey/authenticateForApproval` 包 `@simplewebauthn/browser`。
- **web/DevicesModal**: 顶部横幅"升级 Passkey / 移除"按钮,仅当前设备+WebAuthn 可用时显示。
- **web/PermissionApproval**: 高风险+本设备有 passkey → 按钮改 🔐 Touch ID/Face ID,调 `navigator.credentials.get`,成功后发 `approval.response` 带 `webauthnToken`;失败保持待审批态 + 红色 toast。
- **web/App**: `currentDevice` 扩 `hasPasskey`,`onPasskeyChange` 回写。

## 验证

- `pnpm -r typecheck` 全绿(protocol/host/web)。
- 老设备(无 passkey)审批流不变,高风险仍 500ms 倒计时。
- localhost rpId=`localhost`,虚拟鉴权器可跑;隧道下 rpId=`<sub>.trycloudflare.com`,counter 递增校验防重放。
