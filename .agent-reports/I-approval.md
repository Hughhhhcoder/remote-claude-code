# I · Approval UI (M3 batch 1, Agent C)

## 交付

- `protocol`: `[approvals]` 标记 + `approval.request/response/cleared` 帧 + `ApprovalRisk` enum,加入 discriminatedUnion
- `host/src/approvals.ts` 新建: `ApprovalWatcher` 维护 512KB rolling buffer,feed 时仅扫描尾部 4KB,匹配触发后发 `approval.request`,收到 response 写 `y\r`/`n\r` 到 pty 并发 `cleared`,30s setTimeout 超时。bypassPermissions/acceptEdits/dontAsk 下 skip。
- `host/src/index.ts`: 新增 `approvalWatchers` map + `attachApprovalWatcher(session)` + `approval.response` handler,启动和 session.new 时 attach,session.onExit 时 dispose
- `web/src/PermissionApproval.tsx` 新建: 移动底部滑出 / 桌面居中 modal,风险色(emoji+badge+按钮),可折叠 raw,只同意一次 checkbox(未持久化),高风险 500ms 倒计时禁用按钮
- `App.tsx`: 挂载 `<PermissionApproval>`,零侵入其他逻辑
- CSS: 新 slide-up keyframe

## 启发式的局限(重要)

regex 是保守的,只匹配 `Do you want to (proceed|continue|allow)` 或 `[y/n]|(yes/no)|(Y/n)` 这几种字面量。Claude CLI 若换成本地化文案、多行分裂提示、或通过 ANSI 光标定位而非换行渲染,都会漏报。工具名 inference 限定在已知 tool 集合,未知一律 medium。刻意宁漏报不错报 — 用户仍可在终端直接答。真正结构化审批要等 Claude Agent SDK。

## 约束

- 未碰 permissions.ts / hooks.ts 等其他 host src
- pnpm -r typecheck 全绿
- raw 截断 4KB、buffer 上限 512KB、超时 30s 可靠 clearTimeout
