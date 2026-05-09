# BB · Ops & Starters 扩展

- `packages/host/src/starters.ts` BUILTIN_STARTERS 从 3 条扩到 **11 条**:保留 Code Review / Debug / Plan,新增 New Feature(✨ sky)、Fix Bug(🔧 orange,permissionMode=plan)、Explain Code(📖 cyan)、Write Tests(🧪 lime)、Refactor(🧹 teal,permissionMode=acceptEdits)、Security Review(🛡️ red,firstSteps slash `security-review`)、Doc Writer(📝 amber)、Standup Reflection(📓 fuchsia)。每条带独立 icon + color + 对应 firstSteps prompt/slash。未启用 `enableSkills`(无对应 builtin skill 可挂)。
- 新建 `docs/operations.md`:首次启动 8 步 checklist · 真实扫出 10 条 `RCC_*` env 表(扫自 `packages/host/src/*.ts`:`RCC_PORT/CWD/CLAUDE_CMD/CLAUDE_ARGS/PERMISSION_MODE/TRUST_LOOPBACK/WEB_DIST/WATCHDOG_MEM_MB/TUNNEL` + transit `ANTHROPIC_API_KEY/LANG`)· 三场景(本地 / cloudflared Named Tunnel / Docker 占位)· 日常运维(日志源 / 设备管理 / share revoke 走 Web UI 或 `DELETE /api/v1/shares/<id>` 因 admin CLI 未暴露 / metrics / 升级通道)· 故障排查(ws / node-pty / libsodium / EADDRINUSE / acceptEdits 需 Passkey / watchdog)· backup 走 `tar ~/.rcc` + restore 注意事项 · 资源参考(RSS ≈ 80 + 50×session)。
- `FEATURES.md` Starter Kits 行 notes 更新到 10+ builtin + 列明新增卡名;M10 加"文档扩展 (starters seed + ops)"行;`变更日志` 加 Batch 18 C 条目。
- `pnpm -r typecheck` 全绿(4/4 workspace)。
