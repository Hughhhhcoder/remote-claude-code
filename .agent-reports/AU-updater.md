# AU — 真实自动升级 (Batch 16 B)

## 完成

- `packages/host/src/updater.ts` — `Updater` 类:check / download(sha256 流式校验 + AbortController 可取消,tmp .part → rename) / apply(execFile tar 解压 staging → 原子 rename,symlink ~/.local/bin/rcc,800ms 后 process.exit(0))
- `packages/protocol/src/index.ts` — 加 `UpdateManifest` / `UpdaterStatusData` + 6 帧(update.check/download/apply/abort.request + update.status/progress/ready)
- `packages/host/src/index.ts` — ws case 分发 + POST `/update/check|download|apply`(全 authenticated);boot 5s + 每 6h 自动 probe
- `packages/web/src/VersionBadge.tsx` — popover 按 UpdaterState 渲染下载按钮 / 进度条 / 应用按钮 / ready 提示
- FEATURES.md 更新

## 约束满足

- `pnpm -r typecheck` 全绿
- 下载走 .part tmp,sha256 校验通过才 rename(失败不破坏旧安装)
- 解压到 staging dir 再 rename 到最终路径,失败会清理 staging
- symlink 更新是 best-effort,失败 warn 不 abort

## ⚠ 威胁:签名缺失

第一版**只做 sha256**,能防传输损坏,**不防中间人**:攻击者若控制 `manifestUrl`(用户自配)或 MitM manifest/下载链路(CA 妥协 / 自签证书),可发布任意 tar.gz 并给出匹配 sha256 → host 信任 → 解压到 `~/.rcc/install/` 并替换 `~/.local/bin/rcc` symlink → RCE。缓解仅靠 HTTPS + 用户自己信任 manifest 域名。

v1.1 必须加 **minisign**:manifest 带 `minisignPublicKey` + `minisignSig`(对 tar.gz 的签名),updater 在 sha256 校验后再跑签名校验,公钥硬编码或首次使用时 TOFU。
