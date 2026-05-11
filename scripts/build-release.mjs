#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, chmodSync, createReadStream } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");
const PKGS = join(ROOT, "packages");

const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const hostPkg = JSON.parse(readFileSync(join(PKGS, "host", "package.json"), "utf8"));
const VERSION = rootPkg.version || hostPkg.version || "0.0.0";

const PLATFORM_MAP = { darwin: "darwin", linux: "linux" };
const ARCH_MAP = { x64: "x64", arm64: "arm64" };
const platform = PLATFORM_MAP[process.platform];
const arch = ARCH_MAP[process.arch];
if (!platform || !arch) {
  console.error(`unsupported platform ${process.platform}-${process.arch}`);
  process.exit(1);
}
const PLATFORM_TAG = `${platform}-${arch}`;

const RELEASE_ROOT = join(ROOT, "release");
const STAGE_NAME = `rcc-${VERSION}`;
const STAGE = join(RELEASE_ROOT, STAGE_NAME);
const TARBALL = join(RELEASE_ROOT, `rcc-${VERSION}-${PLATFORM_TAG}.tar.gz`);

function log(msg) {
  console.log(`[build-release] ${msg}`);
}

function run(cmd, opts = {}) {
  log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

function ensureTempTsconfig(pkgDir) {
  const p = join(pkgDir, "tsconfig.build.json");
  const body = {
    extends: "./tsconfig.json",
    compilerOptions: {
      outDir: "dist",
      rootDir: "src",
      noEmit: false,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      verbatimModuleSyntax: false,
      declaration: false,
      sourceMap: false,
    },
  };
  writeFileSync(p, JSON.stringify(body, null, 2));
  return p;
}

function cleanSlate() {
  rmSync(join(PKGS, "host", "dist"), { recursive: true, force: true });
  rmSync(join(PKGS, "protocol", "dist"), { recursive: true, force: true });
  rmSync(join(PKGS, "cli", "dist"), { recursive: true, force: true });
  rmSync(join(PKGS, "web", "dist"), { recursive: true, force: true });
  rmSync(STAGE, { recursive: true, force: true });
  rmSync(TARBALL, { force: true });
  mkdirSync(RELEASE_ROOT, { recursive: true });
}

function buildAll() {
  log("typecheck all packages");
  run("pnpm -r typecheck");

  log("compile @rcc/protocol");
  ensureTempTsconfig(join(PKGS, "protocol"));
  run("pnpm exec tsc -p tsconfig.build.json", { cwd: join(PKGS, "protocol") });

  log("compile @rcc/host");
  ensureTempTsconfig(join(PKGS, "host"));
  run("pnpm exec tsc -p tsconfig.build.json", { cwd: join(PKGS, "host") });

  log("build @rcc/cli");
  run("pnpm -F @rcc/cli build");

  log("build @rcc/web");
  run("pnpm -F @rcc/web build");
}

function stage() {
  log(`staging ${STAGE}`);
  mkdirSync(STAGE, { recursive: true });
  mkdirSync(join(STAGE, "bin"), { recursive: true });
  mkdirSync(join(STAGE, "lib"), { recursive: true });
  mkdirSync(join(STAGE, "lib", "host"), { recursive: true });
  mkdirSync(join(STAGE, "lib", "cli"), { recursive: true });
  mkdirSync(join(STAGE, "lib", "web"), { recursive: true });
  mkdirSync(join(STAGE, "lib", "protocol"), { recursive: true });

  cpSync(join(PKGS, "host", "dist"), join(STAGE, "lib", "host"), { recursive: true });
  writeFileSync(
    join(STAGE, "lib", "host", "package.json"),
    JSON.stringify({
      name: "@rcc/host",
      version: VERSION,
      type: "module",
      main: "./index.js",
    }, null, 2),
  );

  cpSync(join(PKGS, "cli", "dist"), join(STAGE, "lib", "cli", "dist"), { recursive: true });
  writeFileSync(
    join(STAGE, "lib", "cli", "package.json"),
    JSON.stringify({
      name: "@rcc/cli",
      version: VERSION,
      type: "module",
      main: "./dist/index.js",
    }, null, 2),
  );

  cpSync(join(PKGS, "web", "dist"), join(STAGE, "lib", "web", "dist"), { recursive: true });

  cpSync(join(PKGS, "protocol", "dist"), join(STAGE, "lib", "protocol"), { recursive: true });
  writeFileSync(
    join(STAGE, "lib", "protocol", "package.json"),
    JSON.stringify({
      name: "@rcc/protocol",
      version: VERSION,
      type: "module",
      main: "./index.js",
      types: "./index.d.ts",
    }, null, 2),
  );
}

function installProdDeps() {
  log("resolve prod deps from workspace lockfile");
  const depNames = Object.keys(hostPkg.dependencies || {}).filter((n) => !n.startsWith("@rcc/"));
  const resolved = {};
  for (const name of depNames) {
    const pj = findInstalledPackageJson(name);
    if (!pj) throw new Error(`cannot resolve installed version of ${name}`);
    resolved[name] = `^${pj.version}`;
  }

  const stageRoot = join(STAGE, "lib");
  const tmpPkg = {
    name: "rcc-runtime",
    version: VERSION,
    private: true,
    type: "module",
    dependencies: resolved,
  };
  writeFileSync(join(stageRoot, "package.json"), JSON.stringify(tmpPkg, null, 2));

  log("npm install --omit=dev (may take a minute)");
  run("npm install --omit=dev --no-audit --no-fund --install-strategy=hoisted --ignore-scripts", {
    cwd: stageRoot,
  });

  log("chmod +x node-pty spawn-helper if present");
  try {
    const out = execSync("find node_modules -type f -name spawn-helper -path '*/node-pty/*'", {
      cwd: stageRoot,
      encoding: "utf8",
    });
    for (const p of out.split("\n").filter(Boolean)) {
      const full = join(stageRoot, p);
      if (existsSync(full)) chmodSync(full, 0o755);
    }
  } catch {}

  pruneDeps(stageRoot);

  log("link @rcc/protocol into node_modules");
  const rccDir = join(stageRoot, "node_modules", "@rcc");
  mkdirSync(rccDir, { recursive: true });
  const target = join(rccDir, "protocol");
  rmSync(target, { recursive: true, force: true });
  cpSync(join(stageRoot, "protocol"), target, { recursive: true });
}

function findInstalledPackageJson(name) {
  const direct = join(ROOT, "node_modules", name, "package.json");
  if (existsSync(direct)) return JSON.parse(readFileSync(direct, "utf8"));
  const pnpmDir = join(ROOT, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    const prefix = name.replace(/\//g, "+") + "@";
    const entries = readdirSync(pnpmDir).filter((d) => d.startsWith(prefix));
    for (const e of entries) {
      const p = join(pnpmDir, e, "node_modules", name, "package.json");
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    }
  }
  return null;
}

function pruneDeps(stageRoot) {
  log("prune dev/cross-platform bloat from node_modules");
  const nm = join(stageRoot, "node_modules");

  // node-pty: keep only the prebuild we actually need, drop source + other platforms.
  const pty = join(nm, "node-pty");
  if (existsSync(pty)) {
    for (const junk of ["src", "deps", "third_party", "scripts", "binding.gyp"]) {
      rmSync(join(pty, junk), { recursive: true, force: true });
    }
    const prebuilds = join(pty, "prebuilds");
    if (existsSync(prebuilds)) {
      const keep = `${process.platform}-${process.arch}`;
      for (const d of readdirSync(prebuilds)) {
        if (d !== keep) rmSync(join(prebuilds, d), { recursive: true, force: true });
      }
    }
  }

  // Anthropic native claude binary: drop cross-platform variants.
  const anthropic = join(nm, "@anthropic-ai");
  if (existsSync(anthropic)) {
    const expected = `claude-agent-sdk-${process.platform}-${process.arch}`;
    for (const d of readdirSync(anthropic)) {
      if (d.startsWith("claude-agent-sdk-") && d !== expected && d !== "claude-agent-sdk") {
        rmSync(join(anthropic, d), { recursive: true, force: true });
      }
    }
    // Drop .d.ts files from SDK packages (runtime-only).
    for (const d of readdirSync(anthropic)) {
      stripDts(join(anthropic, d));
    }
  }

  // Global prune: d.ts and md files we don't need at runtime.
  stripRepos(nm);
}

function stripDts(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      stripDts(p);
    } else if (entry.endsWith(".d.ts") || entry.endsWith(".d.ts.map") || entry.endsWith(".map")) {
      rmSync(p, { force: true });
    }
  }
}

function stripRepos(nm) {
  // Drop README / test / docs dirs from transitive deps to slim the tarball.
  const walk = [nm];
  const skipDirs = new Set(["test", "tests", "__tests__", "docs", "examples", "example", ".github"]);
  while (walk.length) {
    const d = walk.pop();
    let entries;
    try { entries = readdirSync(d); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (skipDirs.has(e)) {
          rmSync(p, { recursive: true, force: true });
        } else {
          walk.push(p);
        }
      } else if (e === "CHANGELOG.md" || e === "HISTORY.md" || e === ".npmignore" || e === ".eslintrc" || e === ".eslintrc.js" || e === ".eslintrc.json") {
        rmSync(p, { force: true });
      }
    }
  }
}

function writeLaunchers() {
  const resolveSelf = `SELF="$0"
while [ -L "$SELF" ]; do
  LINK=$(readlink "$SELF")
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
DIR=$(cd "$(dirname "$SELF")/.." && pwd)`;
  const hostLauncher = `#!/bin/sh
# rcc host launcher
set -eu
${resolveSelf}
if ! command -v node >/dev/null 2>&1; then
  echo "rcc: node is required (>= 20). Install from https://nodejs.org" >&2
  exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then
  echo "rcc: node $MAJOR detected, need >= 20" >&2
  exit 1
fi
# Subcommands handled by update.js (no host boot).
case "\${1-}" in
  update|version|--version|-v)
    export RCC_INSTALL_DIR="$DIR"
    export RCC_SELF_PATH="$0"
    exec node --no-deprecation "$DIR/lib/host/update.js" "$@"
    ;;
esac
export RCC_WEB_DIST="\${RCC_WEB_DIST:-$DIR/lib/web/dist}"
exec node --no-deprecation "$DIR/lib/host/index.js" "$@"
`;
  writeFileSync(join(STAGE, "bin", "rcc"), hostLauncher);
  chmodSync(join(STAGE, "bin", "rcc"), 0o755);

  const cliLauncher = `#!/bin/sh
# rcc CLI launcher
set -eu
${resolveSelf}
if ! command -v node >/dev/null 2>&1; then
  echo "rcc: node is required (>= 20). Install from https://nodejs.org" >&2
  exit 1
fi
exec node --no-deprecation "$DIR/lib/cli/dist/index.js" "$@"
`;
  writeFileSync(join(STAGE, "bin", "rcc-cli"), cliLauncher);
  chmodSync(join(STAGE, "bin", "rcc-cli"), 0o755);

  const adminLauncher = `#!/bin/sh
# rcc admin launcher (trust store CLI)
set -eu
${resolveSelf}
if ! command -v node >/dev/null 2>&1; then
  echo "rcc: node is required (>= 20)" >&2
  exit 1
fi
exec node --no-deprecation "$DIR/lib/host/admin.js" "$@"
`;
  writeFileSync(join(STAGE, "bin", "rcc-admin"), adminLauncher);
  chmodSync(join(STAGE, "bin", "rcc-admin"), 0o755);
}

function writeManifest() {
  writeFileSync(
    join(STAGE, "package.json"),
    JSON.stringify({
      name: "rcc",
      version: VERSION,
      private: true,
      description: "Remote Claude Code single-binary release",
      platform: PLATFORM_TAG,
      engines: { node: ">=20" },
    }, null, 2),
  );
  for (const f of ["README.md"]) {
    const src = join(ROOT, f);
    if (existsSync(src)) cpSync(src, join(STAGE, f));
  }
  writeFileSync(
    join(STAGE, "INSTALL.md"),
    `# rcc ${VERSION} (${PLATFORM_TAG})

Requires Node.js >= 20 on PATH.

\`\`\`
./bin/rcc          # start host (serves web + websocket)
./bin/rcc-cli      # CLI client
./bin/rcc-admin    # trust store admin
\`\`\`

See README.md for usage.
`,
  );
}

async function tarGz() {
  log(`packing ${TARBALL}`);
  run(`tar -cf - -C "${RELEASE_ROOT}" "${STAGE_NAME}" | gzip -9 > "${TARBALL}"`);
}

function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function dirSize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const p = stack.pop();
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) stack.push(join(p, e));
    } else {
      total += st.size;
    }
  }
  return total;
}

function human(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function main() {
  const skipTypecheck = process.argv.includes("--skip-typecheck");
  cleanSlate();
  if (skipTypecheck) {
    log("skip typecheck");
    ensureTempTsconfig(join(PKGS, "protocol"));
    run("pnpm exec tsc -p tsconfig.build.json", { cwd: join(PKGS, "protocol") });
    ensureTempTsconfig(join(PKGS, "host"));
    run("pnpm exec tsc -p tsconfig.build.json", { cwd: join(PKGS, "host") });
    run("pnpm -F @rcc/cli build");
    run("pnpm -F @rcc/web build");
  } else {
    buildAll();
  }
  stage();
  installProdDeps();
  writeLaunchers();
  writeManifest();
  await tarGz();

  const sha = sha256File(TARBALL);
  const tarBase = `rcc-${VERSION}-${PLATFORM_TAG}.tar.gz`;
  writeFileSync(`${TARBALL}.sha256`, `${sha}  ${tarBase}\n`);

  const shaFile = join(RELEASE_ROOT, "SHA256SUMS");
  const line = `${sha}  ${tarBase}\n`;
  let existing = "";
  if (existsSync(shaFile)) {
    existing = readFileSync(shaFile, "utf8")
      .split("\n")
      .filter((l) => l && !l.endsWith(tarBase))
      .join("\n");
    if (existing && !existing.endsWith("\n")) existing += "\n";
  }
  writeFileSync(shaFile, existing + line);

  const stageSize = dirSize(STAGE);
  const tarSize = statSync(TARBALL).size;
  log("=== done ===");
  log(`stage:    ${STAGE}`);
  log(`size:     ${human(stageSize)} unpacked`);
  log(`tarball:  ${TARBALL}`);
  log(`packed:   ${human(tarSize)}`);
  log(`sha256:   ${sha}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
