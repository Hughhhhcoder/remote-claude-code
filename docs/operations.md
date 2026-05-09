# 运维指南

面向已经部署 RCC (Remote Claude Code) 的运维/自部署用户。安装步骤见 [install.md](./install.md)。

本文按 **首次启动 → 环境变量 → 部署场景 → 日常运维 → 故障排查 → 备份恢复 → 资源参考** 组织。

---

## 1. 首次启动 checklist

1. **Node.js ≥ 20** 已就位:`node -v` 看一眼。
2. 启动 host:`rcc` 或 `pnpm dev:host`(源码模式)。默认监听 `127.0.0.1:7777`。
3. **查 `~/.rcc/` 目录已自动创建**:`ls -la ~/.rcc/`,至少能看到 `keys.json`、`trust.json`、`audit.jsonl`。
4. 浏览器打开 host 打印的本机 URL(默认 http://localhost:7777)。loopback 免 auth,直接进。
5. 远端访问必须配 tunnel(见 [部署场景 2](#场景-2-云端-vps--cloudflared)),同时首次打开会弹 **6 位配对码**,在 host 终端看码,手机输入即可信任该设备。
6. 配对完成后 token 写 localStorage,下次自动登录。
7. 访问 `/api/openapi.json` 验 REST API 可达;访问 `/metrics`(带 Bearer token)验观测面板数据源。
8. (可选)装 `rcc-admin` CLI 别名 `alias rcca="rcc-admin"`,管设备/会话更顺手。

---

## 2. 环境变量

所有 `RCC_*` 变量,host 真实读取路径(均在 `packages/host/src/`):

| 变量 | 默认 | 说明 |
|---|---|---|
| `RCC_PORT` | `7777` | host ws+HTTP 监听端口 |
| `RCC_CWD` | `process.cwd()` | host 启动时默认 project cwd(被 `~/.rcc/projects.json` 覆盖) |
| `RCC_CLAUDE_CMD` | `claude` | Claude CLI 可执行名/路径(PTY + MCP 子进程共用) |
| `RCC_CLAUDE_ARGS` | *(空)* | 追加给 Claude CLI 的空格分隔参数 |
| `RCC_PERMISSION_MODE` | `default` | 新 session 默认权限模式:`default` / `plan` / `acceptEdits` / `bypassPermissions` |
| `RCC_TRUST_LOOPBACK` | `1` | `=0` 时 loopback 连接也强制走 token auth |
| `RCC_WEB_DIST` | `../../web/dist`(相对 host) | 静态 web bundle 目录,release tarball 里 launcher 自动注入 |
| `RCC_WATCHDOG_MEM_MB` | `1024` | watchdog RSS 告警阈值(MB);超阈值广播 `health.warn` |
| `RCC_TUNNEL` | *(未设)* | `1`/`true`/`on`/`named` 开 cloudflared。详见 [场景 2](#场景-2-云端-vps--cloudflared) |
| `ANTHROPIC_API_KEY` | *(从 shell 继承)* | 透传给 Claude CLI 子进程,不被 host 读 |
| `LANG` | *(系统)* | 透传给 PTY,避免 locale 乱码 |

额外 tunnel 字段从 `~/.rcc/config.json` 读,参见 [场景 2](#场景-2-云端-vps--cloudflared)。

---

## 3. 部署场景

### 场景 1 · 本地单机开发

```sh
pnpm install
pnpm dev:host    # 7777
pnpm dev:web     # 5273
open http://localhost:5273
```

loopback 免 auth,适合开发+调试。生产请走场景 2。

### 场景 2 · 云端 VPS + cloudflared(推荐)

Named Tunnel 模式(稳定,固定域名,CI/CD 友好):

1. VPS 上装 `cloudflared` 并 `cloudflared tunnel login` 拿 credentials。
2. 创建 tunnel:`cloudflared tunnel create rcc` → 得 UUID 与 `~/.cloudflared/<uuid>.json`。
3. DNS:`cloudflared tunnel route dns rcc rcc.example.com`。
4. 写 `~/.rcc/config.json`:
   ```json
   {
     "tunnel": {
       "mode": "named",
       "name": "rcc",
       "hostname": "rcc.example.com",
       "credentialsFile": "~/.cloudflared/<uuid>.json"
     }
   }
   ```
5. 启动:`RCC_TUNNEL=named rcc`。host 自动 spawn cloudflared,public URL 同时提供 web UI + ws。
6. 首次访问弹配对,看 VPS 上 host stdout 里的 6 位码,手机输入完成配对。

快速试用可用 TryCloudflare(临时 URL):`RCC_TUNNEL=1 rcc`。不推荐长期用。

### 场景 3 · Docker

尚无官方 `Dockerfile`。自行封装时要点:
- `node:20-alpine` 基础镜像即可。
- 把 tarball 解压到 `/opt/rcc`,`ENTRYPOINT ["/opt/rcc/bin/rcc"]`。
- **挂载** `~/.rcc` 为 volume(所有状态在此),否则容器重启全丢。
- 暴露 `7777`,反代前请把 tunnel/TLS 放到外层(Caddy / nginx / cloudflared)。
- Node ≥ 20 与 glibc(别用 `alpine` 如果 libsodium native 报错,用 `node:20-slim`)。

---

## 4. 日常运维

### 看日志

| 来源 | 位置 | 用途 |
|---|---|---|
| host stdout | 终端 / systemd journal | 启动、连接、PTY、tunnel 状态、health.warn |
| 崩溃日志 | `~/.rcc/crashes.log` | uncaughtException / unhandledRejection 栈 |
| 审计日志 | `~/.rcc/audit.jsonl` | append-only,按日 rotate(`audit.jsonl.YYYY-MM-DD`),30 天保留 |
| Web Audit 视图 | ConfigView → Audit tab | 对 audit.jsonl 的可视化查询(kind + 时间 + 关键词) |

快速看最近审计:`tail -n 50 ~/.rcc/audit.jsonl | jq`。

### 管理设备

- Web UI:SettingsModal → Devices,吊销/重命名。
- CLI:
  ```sh
  rcc-admin devices                  # 列出
  rcc-admin revoke <device-id>       # 吊销
  rcc-admin rename <device-id> <new>
  ```

### 撤销 share 链接

`rcc-admin` 目前不暴露 `share revoke`。两条路:
- **Web UI** 里 session 下拉 → "Manage shares" → 点红 X。
- **REST**:
  ```sh
  curl -X DELETE -H "Authorization: Bearer $TOKEN" \
    https://rcc.example.com/api/v1/shares/<share-id>
  ```

### 扫 metrics

```sh
curl -sS -H "Authorization: Bearer $TOKEN" https://rcc.example.com/metrics | jq
```

关注字段:`rss`、`sessions`、`ws.active`、`ws.drops.backpressure`、`ws.drops.rate_limit`、`sdk.turns`。watchdog 每 60s 采样,超阈值走 ws `health.warn` 推到 UI。

### 管理会话快照

```sh
rcc-admin sessions             # 列 ~/.rcc/sessions/*.json
rcc-admin sessions --stale     # 删闲置 > 30 天
rcc-admin sessions --purge     # 一把梭全删
```

### 升级

| 通道 | 命令 |
|---|---|
| curl\|sh(推荐) | `curl -fsSL …/install.sh \| bash`(脚本幂等,会覆盖当前 install) |
| Homebrew | `brew upgrade rcc` |
| 源码 | `git pull && pnpm install && pnpm build:release` |
| Web UI 自动提示 | Updater 每小时 probe GitHub releases,新版本 Inbox 弹横幅(仅提示,不自动执行) |

升级前建议 `cp -r ~/.rcc ~/.rcc.bak-YYYYMMDD`(见 [备份](#6-备份--恢复))。

---

## 5. 故障排查

### 连不上 ws

1. 检查 tunnel 是否 ready:host stdout 最后应打出 `tunnel ready: <url>`。没有 → cloudflared 未跑或 credentials 失效,重跑 `cloudflared tunnel list` 确认。
2. 检查 token:Web UI 报 `unauthorized`/自动退回配对页 → localStorage token 过期或已被 `rcc-admin revoke`,重走配对。
3. 检查防火墙:VPS iptables/ufw 没开 `7777` 也没关系(cloudflared 走 outbound),但如果你绕开 tunnel 直连,必须开端口。
4. `ws.drops.backpressure`/`rate_limit` 在 /metrics 持续涨 → 客户端或链路拥塞,看浏览器 devtools Network 是否在 `pause`。

### `node-pty` crashed / ENOENT

native 模块对应 Node 版本没编译。修复:

```sh
pnpm postinstall   # 源码模式
# 或重装 release tarball
```

发行版 tarball 里已按目标平台 prebuild,装错平台同样会挂。

### `libsodium` / `sodium_malloc` 报错

Node < 20 或 glibc 太旧。`node -v` 确认 ≥ 20。Alpine 用户换 `node:20-slim`(glibc)。

### `EADDRINUSE :7777`

```sh
lsof -iTCP:7777 -sTCP:LISTEN
kill <pid>     # 或 RCC_PORT=7778 rcc
```

### Permission mode 打不开 `acceptEdits` / `bypassPermissions`

这两档要求 token 已过 Passkey 二次确认(见 M5 · WebAuthn)。Web UI 会在切换时自动弹,拒绝则回落 `default`。

### watchdog 频繁 `health.warn`

看 MetricsPanel 的 RSS sparkline:
- 持续爬升 → 多半是一个 session 的 snapshot 太大或 plugin leak,逐个 close session 观察。
- 抖动但稳态 < 阈值 → 调 `RCC_WATCHDOG_MEM_MB=2048` 放宽。

---

## 6. 备份 & 恢复

**备份**(冷备份,host 停不停都行,热备份用 `cp -a`):

```sh
tar czf rcc-backup-$(date +%Y%m%d).tgz -C ~ .rcc
```

`~/.rcc/` 目录包含所有状态:

| 文件/目录 | 内容 |
|---|---|
| `keys.json` | host 的 X25519 密钥对,**丢失会作废所有 E2E 密文** |
| `trust.json` | 已配对设备 |
| `config.json` | tunnel / prefs |
| `sessions/*.json` | 会话快照(chat / usage / cwd / model) |
| `audit.jsonl*` | 审计流 |
| `peers.json` | 联邦 peer |
| `skills/` / `plugins/` | 装好的 skill / plugin |
| `starters.json` / `prompts.json` / `workflows/` / `notebooks/` | 用户模板 |
| `permissions.json` / `pinned-commands.json` | 策略 |
| `crashes.log` | 崩溃栈 |

**恢复**:

```sh
systemctl stop rcc 2>/dev/null || true
rm -rf ~/.rcc
tar xzf rcc-backup-YYYYMMDD.tgz -C ~
rcc    # host 重启自动 rehydrate,所有设备无感
```

> 注意:不要只恢复部分文件 — trust 和 keys 必须同代,否则所有设备需重新配对。

---

## 7. 资源使用参考

真实值按 workload 波动,以下为经验数(基于 M7 soak 脚本 5-30 分钟观测,macOS arm64):

| 指标 | 基线 | 说明 |
|---|---|---|
| host 空载 RSS | 50-80 MB | 无 session,web bundle 已服务 |
| 1 个活跃 session 增量 | ≈ 50 MB RSS | PTY + ring buffer + chat index |
| 10 个并发 session | 500-700 MB RSS | 线性外推,实际稍省(共享 web bundle) |
| watchdog 默认阈值 | 1024 MB | `RCC_WATCHDOG_MEM_MB` 可调 |
| ws inbound rate limit | 100 frames/s per conn | 超了 close(1008),客户端快速重连 |
| ws outbound drop 阈值 | bufferedAmount > 1 MB | 丢非关键帧,ring buffer 补 |

规划容量:**RSS ≈ 80 MB + 50 MB × 平均活跃 session 数**。单机跑 10-15 session 无压力,再多建议分多 host + 联邦(peers.json)。

---

## 延伸阅读

- [install.md](./install.md) — 安装与卸载
- [../FEATURES.md](../FEATURES.md) — 特性矩阵
- [../CHANGELOG.md](../CHANGELOG.md) — 版本变更
