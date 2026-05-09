# M5 batch 1 · 应用层 E2E 加密

## 威胁模型

**目标**:即使 cloudflared tunnel / 反向代理 / 中间 TLS 终止节点被攻破、记录到 ws 流量,攻击者也无法读/改 ws 帧内容。host 与 web 在 TLS 之内再加一层 libsodium secretbox。per-device 共享对称密钥在配对时通过 X25519 ECDH 协商:客户端每次 `/pair/claim` 临时生成 keypair,把 pub 发给 host,host 用长期私钥(`~/.rcc/keys.json` 0600)做 scalarmult 得到 32B 共享密钥,双方各自缓存(host 在 trust.json,web 在 localStorage `rcc.e2e.key`)。每条帧新 24B 随机 nonce。

**非目标**:host 被物理接管(掌握主密钥 + trust.json,读明文即可);前向保密(host 掉长期 key → 所有历史加密会话可解)。

## 已知限制

1. **无重放防护** — nonce 仅用作 secretbox 唯一性,不校验是否重复发送;M5 batch 2 的 nonce window 专门做此事。
2. **非 PFS** — 共享密钥从 host 长期 keypair 派生,host priv 泄露即全失守(包括之前录到的密文)。
3. **Host 妥协 = 全失守** — host 掌握所有 sharedKey 明文,非隐私信任最小化架构。
4. **向后兼容留的明文洞** — 老设备(trust.json 无 sharedKey)会自动降级到明文通路,仅打 warning;需用户主动重新配对升级到 E2E。loopback 默认也放行明文方便开发。
5. **Host 私钥未额外加密** — `~/.rcc/keys.json` 只靠文件权限(0600),无 passphrase。
