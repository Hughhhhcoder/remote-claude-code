#!/usr/bin/env node
/**
 * rcc update / version subcommands.
 *
 * Invoked by the rcc launcher shell script when argv is exactly `rcc update`
 * or `rcc version`. Never boots the host. Resolves the latest GitHub release,
 * downloads the platform-matching tarball, verifies sha256, and swaps the
 * install in-place. Refuses to run from the source tree (it needs to know
 * where the tarball was extracted to).
 *
 * Flags:
 *   rcc update                → install latest
 *   rcc update --version=x.y.z → install a specific tag
 *   rcc update --check         → just report what's available
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, renameSync, realpathSync, statSync, writeFileSync, chmodSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = process.env.RCC_REPO || "Hughhhhcoder/remote-claude-code";

const args = process.argv.slice(3); // argv[0]=node, [1]=update.js, [2]=subcommand, [3]+=flags
const wantCheck = args.includes("--check");
const explicitVersion = (() => {
  const m = args.find((a) => a.startsWith("--version="));
  return m ? m.slice("--version=".length) : null;
})();

// Launcher exports RCC_INSTALL_DIR pointing at the current install root.
const INSTALL_DIR = process.env.RCC_INSTALL_DIR;

function say(msg: string) {
  process.stdout.write(`\x1b[1;36m==>\x1b[0m ${msg}\n`);
}
function warn(msg: string) {
  process.stderr.write(`\x1b[1;33mwarn:\x1b[0m ${msg}\n`);
}
function die(msg: string): never {
  process.stderr.write(`\x1b[1;31merror:\x1b[0m ${msg}\n`);
  process.exit(1);
}

function currentVersion(): string {
  // Read lib/host/package.json next to the installed tree.
  if (INSTALL_DIR) {
    const pj = join(INSTALL_DIR, "lib", "host", "package.json");
    if (existsSync(pj)) {
      try { return JSON.parse(readFileSync(pj, "utf8")).version ?? "0.0.0"; } catch {}
    }
  }
  // Source-tree fallback.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "..", "package.json"),       // packages/host/src/ → repo root
    resolve(here, "..", "..", "package.json"),             // lib/host/ → install dir
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")).version ?? "0.0.0"; } catch {}
    }
  }
  return "0.0.0";
}

function platformTag(): string {
  const p = process.platform;
  const a = process.arch;
  const os = p === "darwin" ? "darwin" : p === "linux" ? "linux" : null;
  const arch = a === "x64" ? "x64" : a === "arm64" ? "arm64" : null;
  if (!os || !arch) die(`unsupported platform ${p}-${a}`);
  return `${os}-${arch}`;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": `rcc-update/${currentVersion()}` } });
  if (!res.ok) die(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": `rcc-update/${currentVersion()}` } });
  if (!res.ok) die(`${url} → HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function resolveLatest(): Promise<string> {
  const data = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const tag: string = data.tag_name ?? "";
  const v = tag.replace(/^v/, "").trim();
  if (!v) die("cannot determine latest release tag");
  return v;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function runUpdate(): Promise<void> {
  const cur = currentVersion();
  const plat = platformTag();
  const target = explicitVersion ?? await resolveLatest();

  say(`current: ${cur}`);
  say(`latest:  ${target}   (${plat})`);

  if (wantCheck) {
    if (cur === target) say("up to date"); else say(`update available → rcc update`);
    return;
  }
  if (!INSTALL_DIR) {
    die(`rcc update only works on installed releases. You're running from source — use 'git pull && pnpm install' instead.`);
  }
  if (cur === target && !explicitVersion) {
    say("already on latest; pass --version=x.y.z to reinstall");
    return;
  }

  const base = `https://github.com/${REPO}/releases/download/v${target}`;
  const tarball = `rcc-${target}-${plat}.tar.gz`;
  const shaSidecar = `${tarball}.sha256`;

  say(`downloading ${tarball}`);
  const tarBuf = await fetchBuffer(`${base}/${tarball}`);

  say(`verifying sha256`);
  let expected: string | null = null;
  try {
    const sidecar = (await fetchBuffer(`${base}/${shaSidecar}`)).toString("utf8");
    expected = sidecar.trim().split(/\s+/)[0] ?? null;
  } catch {
    warn(`no ${shaSidecar} — skipping verification`);
  }
  const actual = sha256(tarBuf);
  if (expected && expected !== actual) {
    die(`sha256 mismatch: expected ${expected}, got ${actual}`);
  }
  if (expected) say(`sha256 OK (${actual.slice(0, 16)}…)`);

  const tmp = join(tmpdir(), `rcc-update-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const tarPath = join(tmp, tarball);
  writeFileSync(tarPath, tarBuf);
  say(`extracting`);
  execSync(`tar -xzf "${tarPath}" -C "${tmp}"`, { stdio: "inherit" });

  const staged = join(tmp, `rcc-${target}`);
  if (!existsSync(join(staged, "bin", "rcc"))) {
    die(`tarball missing bin/rcc — install aborted`);
  }

  // Resolve the PARENT (.../install) where versioned dirs live.
  const installParent = resolve(INSTALL_DIR, "..");
  const newDir = join(installParent, `rcc-${target}`);
  if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true });
  say(`staging to ${newDir}`);
  renameSync(staged, newDir);

  // Repoint symlinks in ~/.local/bin (or wherever). We infer bin dir from
  // the current rcc symlink's parent.
  const selfPath = process.env.RCC_SELF_PATH;
  if (!selfPath) die("RCC_SELF_PATH not set by launcher");
  const binDir = dirname(realpathSync(dirname(selfPath)) === dirname(selfPath)
    ? dirname(selfPath)
    : dirname(selfPath));
  // Actually just use the dir that has the `rcc` symlink.
  const symlinkDir = dirname(selfPath);
  for (const name of ["rcc", "rcc-cli", "rcc-admin"]) {
    const link = join(symlinkDir, name);
    if (existsSync(link)) unlinkSync(link);
    symlinkSync(join(newDir, "bin", name), link);
  }
  say(`updated symlinks in ${symlinkDir}`);

  // Leave the old dir on disk for rollback; prune all but the last 2 installs.
  const versioned = readdirSync(installParent)
    .filter((d) => d.startsWith("rcc-"))
    .map((d) => ({ name: d, ts: statSync(join(installParent, d)).mtimeMs }))
    .sort((a, b) => b.ts - a.ts);
  const keep = new Set(versioned.slice(0, 2).map((v) => v.name));
  for (const v of versioned) {
    if (!keep.has(v.name)) {
      rmSync(join(installParent, v.name), { recursive: true, force: true });
    }
  }

  rmSync(tmp, { recursive: true, force: true });
  say(`done — rcc ${target} installed`);
  say(`run 'rcc' to start the host`);
}

export function runVersion(): void {
  process.stdout.write(`rcc ${currentVersion()} (${platformTag()})\n`);
}

const sub = process.argv[2];
if (sub === "update") {
  runUpdate().catch((err) => die(err?.message ?? String(err)));
} else if (sub === "version" || sub === "--version" || sub === "-v") {
  runVersion();
} else {
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  process.exit(2);
}
