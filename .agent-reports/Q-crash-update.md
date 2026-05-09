# Q-crash-update (M5 batch 6 · Agent B)

- host/crash.ts: 安装 uncaughtException/unhandledRejection 钩子,JSONL append 到 ~/.rcc/crashes.log,超 1MB rename 到 .1,broadcast health.crash。
- host/version.ts: 读 package.json version + main mtime,checkForUpdates 按 ~/.rcc/config.json update.manifestUrl fetch(GitHub releases 或自定义 JSON),解析 tag_name/version,semver 比对,10 min cache,无 URL 返 {configured:false}。
- HTTP: GET /version 和 GET /version/check 都走 authenticate()。不自动下载。
- protocol: [health] 段加 HealthCrash 帧,append 到 union。
- web/VersionBadge.tsx: 顶栏橙徽章 + popover(notes + 复制 git pull),health.crash 触发右下 toast 指向 ~/.rcc/crashes.log。
- pnpm -r typecheck: host + protocol 绿;web 的失败来自并行 agent(PermissionApproval device prop)非本 batch 文件。
