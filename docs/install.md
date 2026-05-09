# 安装指南

RCC (Remote Claude Code) 提供四种安装方式。推荐按平台选择最简单的一条。

> 前置依赖:**Node.js ≥ 20**(macOS `brew install node` / Ubuntu `sudo apt install nodejs`)。
> RCC 把 Node 当成外部 runtime,不自带。

## 方式 1 · 一键脚本 (推荐 · macOS / Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | bash
```

脚本会:

1. 检测你的 OS + CPU 架构(支持 `darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64`)
2. 检查 Node.js 版本 ≥ 20,否则直接报错退出
3. 从 GitHub Releases 下载对应的 `rcc-<version>-<platform>.tar.gz` 与 `.sha256`
4. **校验 sha256**,不匹配立即终止
5. 解压到 `~/.rcc/install/`,symlink `rcc` 与 `rcc-cli` 到 `~/.local/bin/`
6. 提示你把 `~/.local/bin` 加到 `PATH`(若尚未加)

**不使用 sudo**,全部装在用户目录,卸载只需 `rm -rf ~/.rcc/install ~/.local/bin/rcc ~/.local/bin/rcc-cli`。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `RCC_VERSION` | `latest` | 指定 tag,例 `v0.1.0` |
| `RCC_INSTALL_DIR` | `$HOME/.rcc/install` | 解压目录 |
| `RCC_BIN_DIR` | `$HOME/.local/bin` | symlink 目录 |
| `RCC_REPO` | `Hughhhhcoder/remote-claude-code` | GitHub `<owner>/<repo>`(fork 用户可改) |

示例:

```sh
RCC_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | bash
```

## 方式 2 · Homebrew (macOS / Linuxbrew)

```sh
brew tap Hughhhhcoder/remote-claude-code
brew install rcc
```

formula 自动 `depends_on "node"`,会顺带装好 Node ≥ 20。升级:

```sh
brew upgrade rcc
```

卸载:

```sh
brew uninstall rcc
brew untap Hughhhhcoder/remote-claude-code
```

## 方式 3 · 手动下载 tar.gz

前往 [GitHub Releases](https://github.com/Hughhhhcoder/remote-claude-code/releases/latest),挑对应平台:

- macOS Apple Silicon → `rcc-<ver>-darwin-arm64.tar.gz`
- macOS Intel → `rcc-<ver>-darwin-x64.tar.gz`
- Linux x86_64 → `rcc-<ver>-linux-x64.tar.gz`
- Linux ARM → `rcc-<ver>-linux-arm64.tar.gz`

校验并解压:

```sh
curl -fsSLO https://github.com/Hughhhhcoder/remote-claude-code/releases/download/v0.1.0/rcc-0.1.0-darwin-arm64.tar.gz
curl -fsSLO https://github.com/Hughhhhcoder/remote-claude-code/releases/download/v0.1.0/rcc-0.1.0-darwin-arm64.tar.gz.sha256
shasum -a 256 -c rcc-0.1.0-darwin-arm64.tar.gz.sha256
mkdir -p ~/apps/rcc && tar -xzf rcc-0.1.0-darwin-arm64.tar.gz -C ~/apps/rcc
ln -sf ~/apps/rcc/bin/rcc ~/.local/bin/rcc
```

## 方式 4 · 从源码构建

```sh
git clone https://github.com/Hughhhhcoder/remote-claude-code.git
cd rcc
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

访问 <http://localhost:5273>。生产构建产物位于各 `packages/*/dist/`。

## 卸载

| 安装方式 | 卸载 |
|---|---|
| install.sh | `rm -rf ~/.rcc/install ~/.local/bin/rcc ~/.local/bin/rcc-cli` |
| Homebrew | `brew uninstall rcc` |
| 源码 | `rm -rf <clone-dir>` |

用户数据(会话 / 配对 / 插件)位于 `~/.rcc/`。彻底清除需另外 `rm -rf ~/.rcc/`。

## 故障排查

- **`Node.js not found` / 版本过旧**:运行 `node -v`,<20 则升级。macOS `brew upgrade node`,Ubuntu 参考 [NodeSource](https://github.com/nodesource/distributions)。
- **`sha256 mismatch`**:下载过程损坏或 release 被篡改,先 `rm -rf ~/.rcc/install` 重试;持续失败请在 Issues 反馈。
- **`~/.local/bin` 不在 PATH**:把下一行加到 `~/.bashrc` / `~/.zshrc`:
  ```sh
  export PATH="$HOME/.local/bin:$PATH"
  ```
- **node-pty 启动报错**:删 `~/.rcc/install/node_modules/node-pty/build`,再运行一次 install.sh 触发 `scripts/fix-node-pty.mjs` 重编。
