# AH · libsodium Node 25 修复 + E2E 4 spec 扩展

## 修了什么

**libsodium**:`packages/host/src/e2e.ts` 的 `import * as sodium` 在 Node 25 下取不到 `crypto_box_keypair`(libsodium-wrappers 0.8.x ESM 只静态 re-export `ready`/`from_base64` 等少数名字,crypto 原语在 `sodium.ready` 后挂到 default 上)。改成 default import + 运行时 `.default ?? sodiumImport` 兼容 shim,新增 `ensureSodium()` 包装 `await sodium.ready` 并返 typed module。`loadOrCreateHostKeys` 改走它。host 启动时真实生成 X25519 keypair 落 `~/.rcc/keys.json`。webauthn.ts 不用 sodium,无需改。

**E2E fixture**:`tests/e2e/fixtures/host.ts` 去掉 pre-seed keys.json workaround,测试走真实 keygen 路径。

## 新增 4 spec(tests/e2e/specs/)

- `workflows.spec.ts`:配置按钮 → Workflows tab → 新建 → name=test-wf + prompt step=hello → 保存 → 运行 → 断言 WorkflowRunBar "正在运行 workflow test-wf 1/1"
- `context.spec.ts`:切 chat 视图 → 发 prompt → New session → 📋 注入器 → 选源 → "最近 10" → 注入 → dialog 关闭
- `recording.spec.ts`:新建隔离 session(避免前测状态污染)→ ⏺ → ⏹ → ▶ 回放可见 → GET /recording/<sid>.cast 200 + `{"version":2` 开头
- `inbox.spec.ts`:📥 打开 → 全部/审批/提交/系统 tab 循环切换 → 关闭

## 验证

- `pnpm -r typecheck` 全绿
- `pnpm test:e2e` 9/9 通过(~5s),包含原 5 条 + 新 4 条

## 文件

- `packages/host/src/e2e.ts`(import 形 + ensureSodium)
- `tests/e2e/fixtures/host.ts`(删 pre-seed)
- `tests/e2e/specs/{workflows,context,recording,inbox}.spec.ts`(新)
- `FEATURES.md`(M7 表新行 + 变更日志)
