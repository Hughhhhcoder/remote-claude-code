# Agent B · MCP Servers 管理 (M4 Batch 1)

状态：🟢 完成

## 完成项

- `packages/host/src/mcp.ts`：`listMcp / getMcp / addMcp / removeMcp / setMcpEnabled`，全部走 `execFile("claude", ["mcp", ...])`，无 shell 注入风险。解析 `claude mcp list`（文本格式）+ `claude mcp get <name>`（多行字段）。
- `packages/protocol/src/index.ts`：在 `[config-frames]` 标记前加 `McpListRequest / McpList / McpGetRequest / McpGet / McpAdd / McpAdded / McpRemove / McpRemoved / McpToggle`，严格只追加不改动现有帧。
- `packages/host/src/index.ts`：在 `[config-handlers]` 标记前加 5 个 case + 3 个 broadcast helper。所有错误转成 `error` 帧带 `mcp_*_failed` code 返回给发起方。
- `packages/web/src/McpTab.tsx`：表格 + 展开详情（并列 grid：左侧配置字段，右侧环境变量）+ 启用/禁用 toggle switch + 删除按钮。添加弹窗支持 stdio / http / sse，env/headers 动态行，secret-looking key 自动切到 password input。
- `packages/web/src/ConfigView.tsx`：把 `mcp` tab 的 render 指向 `<McpTab client={client} />`。

## 验证

- `pnpm -r typecheck` 全绿。
- `RCC_PORT=7788 RCC_TRUST_LOOPBACK=1 pnpm -F @rcc/host dev` 起 host，ws 测试脚本跑通：
  - `mcp.list` 返回真实列表（包括系统里已有的 `tavily`）
  - `mcp.get tavily` 返回详情，`TAVILY_API_KEY` 被正确识别为 secret 并打码 `***` + length=58
  - `mcp.add` stdio + env 成功，list 里出现
  - `mcp.toggle enabled=false` 把 server 从 `claude mcp` 里移除并写入 `~/.rcc/mcp-disabled.json`，列表里 status 变 `disabled`
  - `mcp.toggle enabled=true` 从缓存恢复，重新 `claude mcp add`
  - `mcp.remove` 真的从 `claude mcp list` 里消失
  - HTTP transport add 也验证通过

## 踩到的坑

1. **`claude mcp add` 的参数顺序很敏感**。`-e KEY=VAL` 是变参选项（variadic），会贪心吃掉后续所有"像 KEY=VAL"的位置参数；因此必须按 `-s <scope> <name> [-e ...] -- <command> [args]` 的顺序组装，否则 `error: missing required argument 'commandOrUrl'`。最初按 "`-s -e ... name command`" 排时失败，改成"name 在前、-e 在中间、`--` 分隔 command"后通过。
2. `claude mcp list` / `get` 没有 `--json` 选项（只有文本输出），只能文本解析。做了宽松 regex，能兼容 stdio 和 http/sse 的 `name: <rest> - <status>` 格式，以及 get 的缩进字段块。
3. `claude mcp list` 输出里 HTTP server 的 commandOrUrl 带 ` (HTTP)` 后缀。没特殊处理，直接原样显示；不影响 get 里的正式 URL 字段。
4. tsx watch 在重复 reload 后会偶尔卡死端口（孤儿 node 进程占 7788），开发时需要 `lsof -i :7788` + `kill -9`。生产没这个问题。

## Disable 方案的实际选择

`claude mcp` CLI 没有原生 `enable/disable`。选择实现为：

- **禁用**：先读 `claude mcp get <name>` 拿到完整配置（command / args / url / env，非 secret 保留明文；secret 值已经从磁盘进程里丢失，只有 env 的 key 名 + masked value），写入 `~/.rcc/mcp-disabled.json`（权限 0600），再 `claude mcp remove` 清掉。
- **启用**：从 `~/.rcc/mcp-disabled.json` 读回 snapshot，调用 `addMcp` 重新注册，清除缓存条目。

**局限 / 取舍**：
- 禁用时我们只能拿到 `claude mcp get` 暴露的 env 值（这些已经是真实值，因为 claude CLI 在服务端信任环境，能给出明文）。所以 **round-trip 保真的前提是 claude CLI 把 env 值按明文返回**（当前版本确实如此）。
- 未来如果 claude CLI 加了真正的 enable/disable 子命令，应该切换成 native 调用，我们的 disabled cache 可删除。
- handler 的 `setMcpEnabled(name, enabled, null, ...)` 第三个参数预留给"客户端重新提交 secret env 值"的场景；目前 UI 没做这个，靠 claude CLI 本身的 env round-trip。

## Remaining questions

1. **工具级开关**：mockup 展示了"每个工具一个 toggle"的粒度控制。当前实现只暴露 server 级启用/禁用，因为 `claude mcp` 没有工具级 disable API，且 MCP 协议本身的工具列表在 runtime 握手时才由 server 返回。若要真正做，需要：(a) host 自己以 MCP client 角色连上 server 拉 `tools/list`，(b) 把用户的 tool 选择存到某个 RCC 配置，(c) 在 prompt time 注入 allowedTools。这是独立一块工作，未做；UI 里详情面板目前只显示 env，没有 tools 列表。建议后续 M4 batch 2 或单独 ticket。
2. **scope 切换**：add 弹窗支持选 scope，但"已存在的 server 换 scope"没做（需要 remove + add 组合，目前用户自己操作就好）。
3. **共享 list 订阅**：当前每个 WS 连接独立请求 `mcp.list.request`。如果多设备同时操作，广播已到位（add/remove/toggle 会 broadcast 到所有 clients），但"打开配置页时" 仍需主动请求一次。这个符合现有 device.list 的模式。
4. **与 Skills agent 的合并**：另一个 agent 在并行改 `ConfigView.tsx` 加了 `activeSid` prop 和 Skills import，没有冲突，我的 mcp tab 兼容签名变化（签名是 `render(client, activeSid)`，我只用 client 参数）。
