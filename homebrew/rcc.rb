class Rcc < Formula
  desc "Remote Claude Code — control claude CLI from any device"
  homepage "https://github.com/Hughhhhcoder/remote-claude-code"
  version "0.1.5"
  license "MIT"

  depends_on "node"

  on_macos do
    on_arm do
      url "https://github.com/Hughhhhcoder/remote-claude-code/releases/download/v#{version}/rcc-#{version}-darwin-arm64.tar.gz"
      sha256 "___FILL_AT_RELEASE___"
    end
    on_intel do
      url "https://github.com/Hughhhhcoder/remote-claude-code/releases/download/v#{version}/rcc-#{version}-darwin-x64.tar.gz"
      sha256 "___FILL_AT_RELEASE___"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Hughhhhcoder/remote-claude-code/releases/download/v#{version}/rcc-#{version}-linux-arm64.tar.gz"
      sha256 "___FILL_AT_RELEASE___"
    end
    on_intel do
      url "https://github.com/Hughhhhcoder/remote-claude-code/releases/download/v#{version}/rcc-#{version}-linux-x64.tar.gz"
      sha256 "___FILL_AT_RELEASE___"
    end
  end

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/rcc"
    bin.install_symlink libexec/"bin/rcc-cli" if (libexec/"bin/rcc-cli").exist?
  end

  test do
    assert_match(/\d+\.\d+\.\d+/, shell_output("#{bin}/rcc --version 2>&1"))
  end
end
