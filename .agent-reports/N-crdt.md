# N · CRDT 多端输入同步

ChatView 底部 textarea 绑定 Y.Text (`docId="input-draft"`),手机+桌面同一 sid 实时同步。

协议新增 `[crdt]` 三帧:`crdt.update`(base64 Y update)、`crdt.sync`、`crdt.sync.request`。

Host (`crdt.ts`) 做 sid-scoped byte relay,**不装 yjs**:每 `sid:docId` 保留最近 200 条 update,新连接 `crdt.sync.request` 顺序回放。这意味 host 不 merge,重启丢历史,长会话 buffer 头可能被 shift(丢失早期编辑),但 input draft 场景 <200 次编辑绰绰有余。单 update 硬上限 64KB 防滥用。

Web (`crdt.ts`) 封装 `createSharedText`,本地 `ydoc.on("update")` 发出去,远端来的 trOrigin 标 `"remote"` 防回环;`origin` uuid 过滤自己回响。ChatView 发送后 `shared.setValue("")` 原子清空同步到所有端。

已知权衡:textarea + Y.Text 非 binding,远端改动会 reset caret。