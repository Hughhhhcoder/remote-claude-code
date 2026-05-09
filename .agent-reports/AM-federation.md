# AM · 多 host 联邦 (Host Federation)

本机 host 现在可以连到远程 RCC host 作为 web 客户端,把对端 sessions 合并到本地 sidebar。

## 实现

- `packages/host/src/federation.ts`:`PeerStore` 读写 `~/.rcc/peers.json`(0600,手写 isPeerConfig 校验,无 zod),`FederatedClient` per-peer ws 客户端,指数退避 max 30s,remote 帧 `rewriteRemoteToLocal` 把 sid 前缀为 `<peerId>:` 并在 `SessionMeta` 打 `peerId/peerLabel/peerColor`,tunnel/device/prefs/metrics/activity/project/peer 等本地元数据不转发。
- `host/index.ts`:`mergedSessionList()` 合并 local + 所有 peer sessions;`handle()` 在 switch 前拦截前缀 sid 做 `rewriteLocalToRemote` 透传 pty.in/attach/chat 等;新增 peer.list.request/peer.add/peer.remove 三个 handler;hello/session.list/created/resumed/close/summary 全改用合并列表;peer 状态变化广播 `peer.status`。
- Protocol:`SessionMeta` 加三个可选字段,新 5 帧 peer.list(.request)/add/remove/status。
- Web:`PeersModal.tsx` CRUD + 安全横幅,顶栏 🌐 N/M 徽章,sidebar "Remote peers" 分组,CommandPalette 加 peers 动作。
- E2E:`tests/e2e/specs/federation.spec.ts` 两用例(无 peer 时无 badge + 模态空态)。第一版不跑双 host 真实联邦(太复杂)。

## 安全限制(重要)

**peer token = 远程 host 超级权限**。持有者可在远程机器上跑任意 shell 命令、读写文件、吊销其他设备。用户必须信任:(1) peer 本身,(2) peer 与本机之间的网络链路(ws 外只有 TLS,无应用层 E2E)。本机 `~/.rcc/peers.json` 是 0600,但一旦泄漏等同交出远程机器控制权。远程 host 如果对该设备强制 E2E,FederatedClient 会报错并离线显示——需用户在远程端把该 peer 设备降级到非 E2E 模式(不推荐)或改用 loopback pair。
