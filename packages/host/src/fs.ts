import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, normalize, isAbsolute } from "node:path";
import type { FileEntry } from "@rcc/protocol";

const MAX_READ_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
const HIDDEN_BLOCKLIST = new Set([".DS_Store"]);

function expanduser(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function allowedRoots(projectCwd: string): string[] {
  const roots = new Set<string>();
  roots.add(resolve(projectCwd));
  roots.add(resolve(homedir()));
  return [...roots];
}

function isWithinRoot(candidate: string, root: string): boolean {
  const rel = normalize(candidate);
  const base = normalize(root);
  if (rel === base) return true;
  const prefix = base.endsWith("/") ? base : base + "/";
  return rel.startsWith(prefix);
}

function normalizePath(p: string, projectCwd: string): string {
  const expanded = expanduser(p);
  if (!isAbsolute(expanded)) {
    return resolve(projectCwd, expanded);
  }
  return resolve(expanded);
}

async function assertAllowed(abs: string, projectCwd: string): Promise<void> {
  const roots = allowedRoots(projectCwd);
  // Check the requested path first.
  if (!roots.some((r) => isWithinRoot(abs, r))) {
    throw new Error("path outside allowed roots");
  }
  // Resolve symlinks and verify the real path is also contained.
  try {
    const real = await realpath(abs);
    if (!roots.some((r) => isWithinRoot(real, r))) {
      throw new Error("path outside allowed roots");
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw err;
  }
}

export async function ls(rawPath: string, projectCwd: string): Promise<{ path: string; entries: FileEntry[] }> {
  const abs = normalizePath(rawPath, projectCwd);
  await assertAllowed(abs, projectCwd);

  let dirents;
  try {
    dirents = await readdir(abs, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new Error(`no such directory: ${abs}`);
    if (code === "ENOTDIR") throw new Error(`not a directory: ${abs}`);
    throw err;
  }

  const entries = await Promise.all(
    dirents
      .filter((d) => !HIDDEN_BLOCKLIST.has(d.name))
      .map(async (d): Promise<FileEntry | null> => {
        const full = join(abs, d.name);
        const isDir = d.isDirectory();
        const isFile = d.isFile();
        if (!isDir && !isFile) {
          // Symlink etc — try stat to resolve.
          try {
            const st = await stat(full);
            if (!st.isDirectory() && !st.isFile()) return null;
            return {
              name: d.name,
              path: full,
              type: st.isDirectory() ? "dir" : "file",
              size: st.isFile() ? st.size : undefined,
              mtime: Math.floor(st.mtimeMs),
            };
          } catch {
            return null;
          }
        }
        try {
          const st = await stat(full);
          return {
            name: d.name,
            path: full,
            type: isDir ? "dir" : "file",
            size: isFile ? st.size : undefined,
            mtime: Math.floor(st.mtimeMs),
          };
        } catch {
          return {
            name: d.name,
            path: full,
            type: isDir ? "dir" : "file",
          };
        }
      }),
  );

  const cleaned = entries.filter((e): e is FileEntry => e !== null);
  cleaned.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: abs, entries: cleaned };
}

export async function statEntry(rawPath: string, projectCwd: string): Promise<FileEntry> {
  const abs = normalizePath(rawPath, projectCwd);
  await assertAllowed(abs, projectCwd);
  const st = await stat(abs);
  const type: FileEntry["type"] = st.isDirectory() ? "dir" : "file";
  return {
    name: abs.split("/").pop() ?? abs,
    path: abs,
    type,
    size: st.isFile() ? st.size : undefined,
    mtime: Math.floor(st.mtimeMs),
  };
}

export async function read(rawPath: string, projectCwd: string): Promise<{
  path: string;
  content: string;
  size: number;
  encoding: "utf8" | "base64";
  truncated?: boolean;
}> {
  const abs = normalizePath(rawPath, projectCwd);
  await assertAllowed(abs, projectCwd);

  let st;
  try {
    st = await stat(abs);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new Error(`no such file: ${abs}`);
    throw err;
  }
  if (!st.isFile()) throw new Error(`not a file: ${abs}`);

  const size = st.size;
  const readSize = Math.min(size, MAX_READ_BYTES);
  const truncated = size > MAX_READ_BYTES;

  const buf = await readFile(abs);
  const slice = truncated ? buf.subarray(0, readSize) : buf;

  // Binary sniff: any NUL byte in first 8KB -> base64.
  const sniff = slice.subarray(0, Math.min(BINARY_SNIFF_BYTES, slice.length));
  let isBinary = false;
  for (let i = 0; i < sniff.length; i++) {
    if (sniff[i] === 0) {
      isBinary = true;
      break;
    }
  }

  if (isBinary) {
    return {
      path: abs,
      content: slice.toString("base64"),
      size,
      encoding: "base64",
      truncated: truncated || undefined,
    };
  }
  return {
    path: abs,
    content: slice.toString("utf8"),
    size,
    encoding: "utf8",
    truncated: truncated || undefined,
  };
}
