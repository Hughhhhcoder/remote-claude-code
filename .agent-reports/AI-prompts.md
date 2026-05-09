# Agent B · 提示模板库 (Prompts)

用户侧 snippet 库,`~/.rcc/prompts.json` 存 `{id,name,template,params,description?,createdAt}`。保存时 regex 提取 `{{param}}` 占位去重保序。限制 template 8KB / 参数 20 个。

新增文件:`packages/host/src/prompts.ts`(PromptStore CRUD + atomic persist)、`packages/web/src/PromptsTab.tsx`(ConfigView 第 8 tab)、`packages/web/src/usePromptExpansion.ts`(detect+fill hook)。Protocol 加 PromptTemplate + 5 帧 prompt.list(.request)/save/saved/remove/removed,并入 Frame union。host/index.ts 加 3 个 handler + mutation 后广播。

ChatView 集成:onInput 里检测 `/p:<name>` 前缀,无参数立即替换;有参数弹小 modal(每参数一个 input,Cmd/Ctrl+Enter 展开),回填原位置不自动发送。CommandPalette 未改。
