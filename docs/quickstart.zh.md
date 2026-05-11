# RCC 使用指南(中文)

> English version: [quickstart.en.md](quickstart.en.md)

从零开始,把本机的 `claude` CLI 连到手机浏览器。全程大约 5 分钟。

---

## 0 · 你需要什么

| 东西 | 说明 |
|---|---|
| 一台电脑 | macOS / Linux,装了 `claude` CLI 并能 `claude --version` 正常输出 |
| Node.js ≥ 20 | `node -v` 检查,没有的话 `brew install node` 或用 nvm |
| 一部手机 | 任何支持现代浏览器(Safari / Chrome / Edge)的手机 |

> 还没装 `claude`?先去 <https://docs.claude.com/en/docs/claude-code> 装好。RCC 不是 `claude` 的替代,是**远程遥控器**。

---

## 1 · 装 RCC

选一种:

```sh
# A · 一键脚本(推荐)
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | sh

# B · 从源码(开发者 / 想看代码)
git clone https://github.com/Hughhhhcoder/remote-claude-code.git
cd remote-claude-code
pnpm install
```

验证:

```sh
rcc version      # 一键脚本路径,打印 "rcc 1.0.0 (darwin-arm64)"
# 或源码:
pnpm dev:host    # 应打印 "[rcc-host] listening on http://localhost:7777"
```

---

## 1.5 · 自我更新(只对一键脚本安装有效)

```sh
rcc update          # 装最新 release
rcc update --check  # 只查有没有新版,不改系统
rcc update --version=1.0.0   # 强制回退 / 重装指定版本
```

更新过程:从 GitHub Releases 下载 `rcc-<ver>-<平台>.tar.gz`,校验 sha256,原地切换符号链接。保留上一版以便回滚(`~/.rcc/install/` 目录下)。

源码安装方式用 `git pull && pnpm install` 即可。

---

## 2 · 选场景:本地 vs 公网

RCC 有两种使用姿势。大多数人要的是 **B(公网)**。

### 场景 A · 同一 Wi-Fi(最安全,最简单)

手机和电脑连同一个路由器,直接走局域网 IP。没有公网暴露。

```sh
rcc            # 或源码:pnpm dev:host
```

查电脑局域网 IP:

```sh
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

假设拿到 `192.168.1.42`,手机浏览器打开:

```
http://192.168.1.42:7777
```

> 端口 **7777** 是 host 默认;源码开发模式前端在 **5273**(带热重载)。
> 首次访问需要配对(见第 3 步)。

### 场景 B · 跨 Wi-Fi / 4G / 任何地方(走 Cloudflare 隧道)

电脑上:

```sh
RCC_TUNNEL=1 rcc
```

终端会打印类似:

```
[tunnel] ready: https://purple-mango-1234.trycloudflare.com
```

手机浏览器打开这个 URL。**不需要开路由器端口、不需要公网 IP、不需要 DDNS**。Cloudflare 替你搭了一条临时隧道。

> 这个随机 URL **每次重启都会变**。要固定域名请看下面 "命名隧道"。

---

## 3 · 手机首次配对

手机打开 URL 后,会看到一个配对页面,有个大大的输入框等你填 **6 位数字**。

电脑终端(跑 `rcc` 那个窗口)里滚动找到:

```
[pair] code = 483902   (expires in 5 min)
```

把 `483902` 输进手机 → 点 "配对" → 绿勾 → 完成。

> 配对码 **只有 5 分钟有效**,用过即焚。超时就刷新手机页面拿新的。
> 配对后手机会拿到一个 per-device token,存 localStorage,下次开直接进。

**把 RCC 装到主屏(iOS / Android 都支持):**

- Safari:分享菜单 → "添加到主屏幕"
- Chrome:右上角 ⋮ → "添加到主屏幕"
- RCC 本身也会在页面显示 **📲 Install** 按钮

装上后像原生 App,全屏、有图标、后台 Web Push 通知都能收到。

---

## 4 · 在手机上做什么

手机上一切和桌面一样:

- 左侧栏点 ➕ 新建 session,挑 cwd / 权限模式 / 是否走 starter kit
- 底部命令面板:直接打字发给 `claude`
- 手机专属:
  - **语音输入**(麦克风图标)— 走 Web Speech API,或配了 OpenAI key 走 Whisper
  - **虚拟键盘工具条**(sticky 在键盘上方)— 一键 Esc / Tab / Ctrl+C / ↑↓
  - **Web Push**(第一次会弹权限)— Claude 要高风险审批(写文件 / 执行命令)时推到锁屏
  - **权限审批专用页** — 大按钮,误触防护

### 典型日常流

1. 早上公司电脑上让 Claude 开个重构 session,中途要出门
2. 手机上打开 RCC → session 列表里找到它 → 接回对话(完整上下文在)
3. 通勤地铁里用语音继续指挥 Claude:"把 ErrorBoundary 拆成独立模块,写完跑一遍测试"
4. 到家后电脑继续 — 手机上的新消息自动同步

---

## 5 · 安全要点(重要)

RCC 默认是**安全的**,但公网暴露前请确认:

- **配对码** 是唯一的信任锚。别把终端截图或录屏发给不熟的人 — 有效期内谁都能用。
- **E2E 加密** 默认开启。手机和 host 之间走 X25519 + libsodium secretbox,Cloudflare 只看到密文。
- **设备管理** `~/.rcc/trust.json` 里可以 `rcc-admin devices` 看 / 删已配对设备。丢手机立刻吊销。
- **权限模式** 默认 `default`(每个敏感操作问你),手机审批专用页一键同意/拒绝。别日常开 `bypassPermissions` — 那相当于 Claude 裸奔执行任何命令。
- **高风险走 Passkey**:在 ConfigView → Permissions 里勾 "require passkey for high-risk",之后重要审批会走 Touch ID / Face ID 二次确认。

详细威胁模型见 [docs/threat-model.md](threat-model.md)。

---

## 6 · 命名隧道(固定公网域名,可选)

每次 `RCC_TUNNEL=1` 的 URL 都不一样,对 PWA 体验不好。要固定域名:

1. 在 Cloudflare dashboard 建一个 Named Tunnel,拿到 `tunnel-id` 和 credentials JSON
2. `~/.rcc/config.json`:
   ```json
   {
     "tunnel": {
       "mode": "named",
       "name": "rcc-home",
       "credentialsFile": "/Users/you/.cloudflared/abc-def.json",
       "hostname": "rcc.yourdomain.com"
     }
   }
   ```
3. 启动:
   ```sh
   RCC_TUNNEL=named rcc
   ```

现在 `https://rcc.yourdomain.com` 永远指向你的电脑(只要 `rcc` 在跑)。

---

## 7 · 常见问题

**Q. 手机页面一直转圈 "connecting..."**
A. 电脑 host 没跑 / 防火墙挡了 / 隧道 URL 过期。电脑上确认 `curl http://localhost:7777/api/v1/health` 返回 `{"ok":true,...}`。

**Q. 配对码输对了但一直提示 invalid**
A. 5 分钟超时了。电脑终端里等下一轮,或重启 `rcc` 立刻拿新码。

**Q. 手机上 `claude` 输出乱码**
A. 启发式 ANSI 剥离偶尔漏一些终端控制序列。切到 "终端视图"(右上角 toggle)看原生 xterm 渲染。

**Q. 电脑关机后手机能看到之前的会话吗?**
A. session 在 host 侧,host 挂了就断。重开 `rcc` 后上次的 session 会自动恢复(快照在 `~/.rcc/sessions/`),手机重连即可。

**Q. 多个设备同时连同一个 session 会怎样?**
A. 支持。所有设备看到完全相同的流,输入任一设备都会生效(CRDT 同步)。

**Q. 隧道 / 公网不安全吧?**
A. Cloudflare 端看不到内容(E2E 加密),隧道本身是 Cloudflare 的加密通道。最弱的环节仍然是**配对码泄露**。

---

## 8 · 下一步

- [架构总览](architecture.md) — 数据流 / 存储 / 模块职责
- [CLI 客户端](../packages/cli/README.md) — 用 `@rcc/cli` 写脚本
- [插件开发](plugin-authoring.md) — 5 分钟写个 Hello World 插件
- [运维指南](operations.md) — 部署、备份、故障排查
- [威胁模型](threat-model.md) — 攻击面和缓解
