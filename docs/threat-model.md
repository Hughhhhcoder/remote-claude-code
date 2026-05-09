# RCC 威胁模型

定位:单用户自部署工具。host 代表你本人,web/cli 客户端代表你本人。"别人"都是攻击者。文档做到能让有安全意识的 reviewer 明白 RCC **能防什么、故意不防什么、哪里有已知漏洞**。

不是正式审计。真要部署到公网,自行决定剩余风险是否可接受。

## 1. Assets (价值物)

| Asset | 位置 | 说明 |
|---|---|---|
| Device tokens | `~/.rcc/trust.json` (0600,仅 sha256) | 泄 = 远程控制 host 全权限 |
| Per-device sharedKey | `~/.rcc/trust.json` | 用于 E2E secretbox;泄 = 被动解密该 device 流量 |
| Host X25519 keypair | `~/.rcc/keys.json` (0600) | 泄 = 所有 device 的 sharedKey 被重算 |
| Session 内容 | 内存 + `~/.rcc/sessions/*.json` + `recordings/*.cast` | 源码、提示、tool_result 可能含密钥 |
| Claude API key | `~/.rcc/config.json` 或 env `ANTHROPIC_API_KEY` | 直接计费,泄 = 钱 |
| `~/.claude/*` config | 用户 Claude 安装,不是 RCC 管的 | RCC 会读写(skills/hooks/permissions),写路径未做沙箱外校验 |
| Peer tokens | `~/.rcc/peers.json` (0600,明文 token) | 一行一超级权限,用户自担 |
| Audit log | `~/.rcc/audit.jsonl` | host 被接管后审计也完了,无远程备份 |
| Share tokens | `~/.rcc/shares.json` (仅 sha256) | 只读,TTL,可撤销;失效后无法恢复 |

## 2. Trust Boundaries

```
┌───────────────────────────────────────────────────┐
│  host 进程 (Node)                                 │ ← 信任:跑在你 Mac,UID=你
│  ~/.rcc/* ~/.claude/* spawn claude ...            │
└────────┬────────────────────┬─────────────────────┘
         │ loopback            │ non-loopback (tunnel / LAN)
         │ (默认信任)          │ Bearer token + 可选 E2E envelope
┌────────▼────────┐   ┌────────▼─────────┐   ┌───────────────┐
│ 本机 web / cli  │   │ 配对过的手机 / PC │   │ 只读分享访客   │
│ RCC_TRUST_LOOP   │   │ token + E2E      │   │ share token    │
│ BACK=0 可关闭   │   │ + (可选 Passkey) │   │ 明文 + 白名单  │
└──────────────────┘   └───────────────────┘   │ 帧过滤         │
                                                └────────────────┘
                             跨 host 联邦
                  ┌──────────────────────────────┐
                  │ 另一台 host 作为 peer        │ ← 超级权限,无 sandbox
                  │ 本 host 把它当受信服务器    │
                  └──────────────────────────────┘
```

关键边界:

- **loopback**: `127.0.0.1` 默认免 token (`RCC_TRUST_LOOPBACK=1`)。前提是机器没被本地恶意进程入侵。
- **外网 / 局域网**: `Authorization: Bearer <token>` 或 `?token=<token>`;没 token 一律 401。
- **E2E envelope**: 配对升级后,ws frame 外包 `{e2e:1,n,c,s,ts}` secretbox,TLS 外再叠一层。loopback 和未升级设备走明文。
- **Share token**: 独立通道,跳过 E2E,帧白名单过滤,只读。

## 3. Threats × Controls × Residual

| # | Attacker / Scenario | Control | Residual Risk |
|---|---|---|---|
| T1 | **MitM cloudflared**(CF 员工 / 受损 CA) | TLS(CF 管) + 应用层 libsodium secretbox + replay window | CF 能丢包/DoS;secretbox 仍可解密不回放,信息机密性保留 |
| T2 | **Stolen device token**(localStorage 被抠 / 二手手机) | Web / CLI / admin 三路吊销,revoke 即时 close(4401);`trust.json` fs.watchFile 热重载;audit.jsonl 记录所有 pair / revoke | 吊销前的窗口期信息已泄,无法撤回;若被吊销方还握着 sharedKey,之前抓到的密文仍可回放解密 |
| T3 | **Malicious plugin**(市场安装或手动放入) | manifest.permissions 声明 + host API 仅按声明开放 + 安装前确认 + audit | **无真沙箱**。plugin 跑在 host Node 进程,有完整 `fs` / 网络权限,可读 `~/.rcc/*` 和 `~/.claude/*`。用户自担。文档已警告。 |
| T4 | **Malicious peer**(联邦里另一台 host) | `peers.json` 0600;sid 前缀 rewrite 隔离命名空间;连接失败不 crash 本地 | peer token 等价超级权限 = 远程 host 可对本 host 发任意帧。用户必须确认 peer 可信。文档警告 + UI 横幅提示。 |
| T5 | **Replay attack**(抓包重放旧帧) | E2E envelope 携 `seq`(uint32)+ `ts`(ms),host + client 各自 64-slot sliding window;±60s 时间戳倾斜;任何 replay → close(4402) | 仅对已升级 E2E 的连接生效,明文通路(loopback / share 访客)不保护 |
| T6 | **Share link 泄漏** | token sha256 存 `shares.json`;TTL 默认 10m–24h;可撤销;只收指定 sid 的 chat/pty 帧;mutation 静默拒绝;过期/撤销 close(4410) | 泄漏期间内容可读;token 不含 E2E 密钥,但原始 session 里 Claude 看到的东西能被看到 |
| T7 | **Token bucket starvation / ws flood** | `backpressure.ts`:per-connection 入 100 frames/s + 出 10MB/s,超限 close(1008);`bufferedAmount > 10MB` close(1013),> 1MB drop 非关键帧 | 攻击者在 token 有效期内可消耗 CPU/网络,但不会 OOM host |
| T8 | **权限审批误确认**(heuristic 漏报 / 按键误触) | `ApprovalWatcher` 启发式识别 Claude y/n 提示 + 三档风险分级;高风险 500ms 防误触;可叠加 Passkey(WebAuthn assertion gate) | CLI driver 靠正则,Claude 未来改输出格式可能漏报(结构化 API 需等 Agent SDK 全面化);SDK driver 有结构化流,不受此影响 |
| T9 | **自升级被替换**(manifest / tar.gz / sha256 三件套被篡改) | 下载流式 sha256 校验,不匹配 abort;原子 rename 后 swap symlink | **无签名验证**。攻击者若控制了 manifest URL + 发布服务器 + 一张受信 CA 就能发有效 sha256 的恶意包。minisign 公钥签名留到 v1.1。 |
| T10 | **Host 本地入侵**(别的 process 以你 UID 跑) | 所有敏感文件 0600;进程隔离靠 OS | UID 级隔离,本地 malware 一旦跑起来 RCC 全失守。边界外问题。 |
| T11 | **Whisper / Anthropic API key 外泄** | `~/.rcc/config.json` 0600;transport 前对 env 中 KEY/TOKEN/SECRET/PASSWORD/AUTH 字段打码 `***` | 插件 / peer / 被接管 host 仍可读明文文件 |
| T12 | **CSRF on REST** | 所有 `/api/v1/*` 要 Bearer,cookie-less | 若前端把 token 存 localStorage,XSS 可读。RCC 信任自己的 web bundle,未用 nonce/CSRF token。 |
| T13 | **Audit 被篡改 / 丢失** | append-only JSONL,0600,按日 rotate,30d retention | 本地 only,无远程 sink;host 被 root 后 audit 可被改。 |

## 4. 已知局限(请在部署前知悉)

- **libsodium**: Node 25 下 CJS/ESM interop 需要 `ensureSodium()` default-import shim。修复过一轮 (Batch AH),但 libsodium 本身升级时留意再测 e2e。
- **Update verify**: sha256-only(防传输损坏,不防对手掌握发布链)。minisign 公钥留 v1.1。
- **Plugin 非沙箱**: 明文警告,不建议装第三方 plugin。未来考虑 Worker + permission gate,非本版本承诺。
- **Approval heuristic**: CLI driver 启发式识别,有漏报/误报空间。真正结构化审批需等 Claude Agent SDK 的 permission callback API 更完善(当前 SDK driver 通路部分覆盖)。
- **Audit log 无远程备份**: host 被接管 = 审计证据也没了。有严格合规需求请自接 sink(推荐 plugin 定期 POST)。
- **Peer token 明文存盘**: `peers.json` 0600 是唯一屏障。
- **Loopback 默认信任**: 多用户机器请立刻 `RCC_TRUST_LOOPBACK=0`。

## 5. 建议部署姿势

最小暴露面:

1. **命名隧道 + 固定子域**(非 TryCloudflare),CF 侧可加 Zero Trust App 再叠一层。
2. `RCC_TRUST_LOOPBACK=0`,所有设备都走 token,连自己 Mac 上的 web 也一样。
3. **不装第三方 plugin**,不加任何 peer,直到需要。
4. 定期 `rcc-admin devices`,删陌生设备。
5. 单独为 RCC 起一个 Unix 用户,`~/.claude/` 只放该用户用的 skills / hooks。
6. Claude API key 走 env 而不是 `~/.rcc/config.json`,降低 plugin / peer 泄露风险。
