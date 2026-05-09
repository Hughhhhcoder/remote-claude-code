import { execFile } from "node:child_process";

const TIMEOUT_MS = 2000;
const MAX_BYTES = 30 * 1024;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface GitStatus {
  branch: string | null;
  dirty: boolean;
  ahead?: number;
  behind?: number;
  head?: string;
}

const READ_ONLY_SUBCMDS = new Set([
  "status",
  "diff",
  "log",
  "branch",
  "blame",
  "show",
  "rev-parse",
  "symbolic-ref",
  "ls-files",
  "shortlog",
  "describe",
  "reflog",
]);

/** Whitelist args by top-level git subcommand — any mutating command is rejected. */
export function isReadOnlyGitArgs(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  const sub = args[0]!;
  return READ_ONLY_SUBCMDS.has(sub);
}

/**
 * Uniform `git` runner: execFile (no shell), 2s wall clock, 30KB stdout/stderr
 * caps. Never throws — failure is reported on GitResult.ok + stderr.
 */
export function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(
      "git",
      ["-C", cwd, ...args],
      { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BYTES * 4 },
      (err, stdout, stderr) => {
        if (settled) return;
        settled = true;
        const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
        const errStr = typeof stderr === "string" ? stderr : String(stderr ?? "");
        const cappedOut = out.length > MAX_BYTES ? out.slice(0, MAX_BYTES) + "\n…(truncated)" : out;
        const cappedErr =
          errStr.length > MAX_BYTES ? errStr.slice(0, MAX_BYTES) + "\n…(truncated)" : errStr;
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          resolve({
            ok: false,
            stdout: cappedOut,
            stderr: cappedErr || (typeof code === "string" ? code : String(err.message)),
            code: typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : null,
          });
          return;
        }
        resolve({ ok: true, stdout: cappedOut, stderr: cappedErr, code: 0 });
      },
    );
    child.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, stdout: "", stderr: "git not found", code: null });
    });
  });
}

/**
 * Read the current branch + dirtyness. Returns null when the cwd is not a git
 * repo (so upstream widgets hide themselves silently).
 */
export async function getStatus(cwd: string): Promise<GitStatus | null> {
  const head = await runGit(cwd, ["rev-parse", "--git-dir"]);
  if (!head.ok) return null;
  const [branchRes, statusRes, headRes, upstreamRes] = await Promise.all([
    runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(cwd, ["status", "--porcelain"]),
    runGit(cwd, ["rev-parse", "HEAD"]),
    runGit(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
  ]);
  const branch = branchRes.ok ? branchRes.stdout.trim() || null : null;
  const dirty = statusRes.ok && statusRes.stdout.trim().length > 0;
  const headSha = headRes.ok ? headRes.stdout.trim() || undefined : undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  if (upstreamRes.ok) {
    const parts = upstreamRes.stdout.trim().split(/\s+/);
    if (parts.length === 2) {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (Number.isFinite(a)) ahead = a;
      if (Number.isFinite(b)) behind = b;
    }
  }
  return { branch, dirty, ahead, behind, head: headSha };
}

export async function getHead(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "HEAD"]);
  if (!r.ok) return null;
  const sha = r.stdout.trim();
  return sha || null;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
}

export async function getLogRange(
  cwd: string,
  fromSha: string,
  toSha: string,
): Promise<GitCommit[]> {
  if (!fromSha || !toSha || fromSha === toSha) return [];
  const sep = "\x1f";
  const r = await runGit(cwd, [
    "log",
    `--pretty=format:%H${sep}%an${sep}%s`,
    `${fromSha}..${toSha}`,
  ]);
  if (!r.ok) return [];
  const out: GitCommit[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split(sep);
    if (parts.length < 3) continue;
    out.push({ hash: parts[0]!.slice(0, 10), subject: parts[2]!, author: parts[1]! });
  }
  return out;
}

/** Quick shallow equality for GitStatus — used by the watcher to avoid
 *  broadcasting identical snapshots every poll. */
export function statusEqual(a: GitStatus | null, b: GitStatus | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.branch === b.branch &&
    a.dirty === b.dirty &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.head === b.head
  );
}
