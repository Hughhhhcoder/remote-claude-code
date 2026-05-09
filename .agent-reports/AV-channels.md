# AV · 发行渠道 (Batch 16 C)

## 新增文件

- `scripts/install.sh` — curl|sh 一键。检测 darwin/linux × arm64/x64、Node ≥ 20,下载 tar.gz + `.sha256`,双路径(`sha256sum`/`shasum`)校验,`RCC_VERSION`/`RCC_INSTALL_DIR`/`RCC_BIN_DIR`/`RCC_REPO` env override,非 sudo 装到 `~/.rcc/install/` + `~/.local/bin/`,PATH 缺失打印 export 提示。`set -eu`,错误 `die` 非 0 退出。
- `homebrew/rcc.rb` — 四平台 stanza,`depends_on "node"`,libexec + bin symlink。sha256 留 `___FILL_AT_RELEASE___`。
- `.github/workflows/release.yml` — push `v*.*.*` 或 workflow_dispatch 触发。矩阵 build 四平台 (darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64),`pnpm build:release` 产 tar.gz + 各自 sha256 上传 artifact;publish job 聚合 + 生 `SHA256SUMS` + `softprops/action-gh-release@v2` 发布;homebrew job 读 sha256 渲染 formula 到 artifact(手动提交 tap)。
- `CHANGELOG.md` — Keep-a-Changelog 格式,M1-M9 精炼。
- `docs/install.md` — 四种安装方式 + env + 故障排查 + 卸载。

## Placeholder 待用户替换

- formula / workflow / docs 均用 `example/rcc` 作 repo URL,换成真实 `<owner>/<repo>`。
- `homebrew/rcc.rb` 四处 `___FILL_AT_RELEASE___` sha256 — release workflow 的 `homebrew` job 会自动渲染覆盖,但用户想直接手交 tap 仍需手填或跑一次 workflow 拷贝渲染产物。
- 尚未自动 commit 到 tap repo(需 PAT / GH App token),当前只上传 artifact。

## FEATURES.md

M9 行 + 变更日志条目已加。
