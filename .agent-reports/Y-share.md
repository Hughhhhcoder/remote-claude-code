# Y - 会话只读分享 (Batch 9 Agent A)

## Delivered

- `host/shares.ts` — ShareStore (sha256 在 `~/.rcc/shares.json` 0600, fs.watchFile 1s 节流热重载, 启动 purge 过期/撤销的历史条目).
- HTTP `POST /share/new`, `GET /share/list?sid=`, `DELETE /share/:id` — 全部走 `authenticate()`; POST 校验 sid 存在;URL 用 Host 头拼 absolute `?share=<token>`.
- WS upgrade 分支:`?share=<token>` 先于 device token 判断;verify 成功标记 `rccShare={id,sid,expiresAt}`;session 不存在返 404。
- readonly 连接:hello 只含 pinned sid + `sharedReadonly/sharedSid/sharedExpiresAt`,自动 attach;`handle()` 白名单 `ping/session.attach/chat.list.request`(且必须匹配 pinned sid),其他帧静默丢弃;`broadcastFiltered` 按 `isFrameAllowedForShare` 仅透传 `hello / chat.* / pty.out / session.exited / pong / error` 的该 sid 帧。
- 撤销/过期/session 消失立即 close(4410);30s sweep + 文件 watch 双路径。
- Protocol: Hello 加 `sharedReadonly/sharedSid/sharedExpiresAt`,新增 `share.list.request / share.list`.
- Web: `RccClient` 加 `shareToken` 选项(禁 E2E、用 `?share=`、send 白名单拦截)、新 status `"readonly"`、4410 → unauthorized 不重连;`SharedReadonlyView` 独立极简页(终端/对话切换 + 倒计时 + 只读水印,无审批/输入);`ShareModal` TTL 四档生成+撤销;SessionRow 🔗 hover 按钮。
- App.tsx 检测 `?share=` 早分支,全程不初始化完整 client。

## 权衡:share 不加密

share 走明文:TLS 层已覆盖信道保密;访客没有设备 sharedKey 所以也不可能走 E2E;token 本身在 URL path 内,仅通过 TLS 传递,与 device token 的威胁模型对等。代价是 host-side 操作者若 tap 了自己进程则能看到明文,但同样场景下 E2E 的意义也仅剩于防 host 维护者——不符合"让访客看对话"这个功能定位。

## 验证

`pnpm -r typecheck` 全绿。
