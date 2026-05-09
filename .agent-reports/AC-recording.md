# AC · 会话录屏 + 回放

新增 asciinema v2 格式会话录制与轻量回放。

**Host** — `packages/host/src/recording.ts` Recorder 类,createWriteStream 模式 `0o600` 写 `~/.rcc/recordings/<sid>.cast`;header JSON 行 + 每 pty.out 追加 `[elapsedSec,"o",data]` JSONL;50 MB cap 触发自动 stop + 清 session recorder 引用。Session 新增 `startRecording / stopRecording / recordingStatus`,pty.onData 里喂 recorder(不动 RingBuffer),pty.exit 自动 seal。host/index.ts 加 `record.start/stop/status.request` 三 ws 帧(仅 CLI Session 可录)+ `GET /recording/:sid.cast` 认证流(`application/x-asciicast`)+ `DELETE /recording/:sid`;sid 正则白名单防路径穿越。

**Protocol** — 四帧 + `RecordingStatusData { sid, recording, size, startedAt, hasFile, capped }`。

**Web** — `RecordingPanel.tsx` 挂 session header(idle 红点 / recording 脉冲 + 实时 KB/MB + elapsed / 有文件 ▶回放 ⬇下载 🗑删除,50MB 截断 ⚠ chip),每 2s 拉 `record.status`。`RecordingPlayback.tsx` 独立 xterm 实例(disableStdin),fetch cast 文件 + 逐行 JSONL parse,requestAnimationFrame 驱动 virtualT 播放;播放/暂停/回到开头/滑杆 seek(reset term 重放到 t)/0.5x·1x·2x·4x 速度。不引入 asciinema-player 库。

`pnpm -r typecheck` 全绿;cast 文件 0600 权限;不含 token/sharedKey。
