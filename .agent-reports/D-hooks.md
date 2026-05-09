# D · Hooks UI

**决策**

- Frame 扁平化：每个 matcher entry 一条 `HookConfig { scope, event, index, matcher?, hooks }`，前端直接按 event 分组。index 即原始 `hooks[event]` 数组下标，保证删除/替换对齐。
- `hook.write` 的 `index === -1` → append；`>= 0` → 就地替换。编辑中切换 scope/event 会先发 `hook.delete` 再 append（见 HooksTab.submitEditor）。
- 禁用/启用：**未单独建模**。Claude Code settings 里没有原生 disable 字段；要关就删，要开就重建。保持和底层语义一致比引入额外 shadow state 干净。
- 测试用 `execFile("sh", ["-c", cmd])`，cwd = project scope 用 RCC_CWD，user scope 用 `$HOME`。stdout/stderr 截 32KB，命令超 32KB 时存盘前同样截并打 `truncated` 标记。timeout 用 hook 自带值，无则 10s。
- 保留原 settings.json 里所有其他键；空事件数组自动删 key；hooks 对象空时删 `hooks` key。所有写操作 `JSON.stringify(_, null, 2)`。

**坑**

- `execFile` callback 签名在 `encoding:"utf8"` 时才是 string，默认是 Buffer，触发 ts never。
- 另一 agent 在同一 marker 插 permissions，protocol 并发编辑需多次重读。
