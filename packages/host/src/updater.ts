import { createHash } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, symlink, unlink, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadConfig } from "./config.ts";
import { getCurrentVersion } from "./version.ts";

const execFileP = promisify(execFile);

export interface UpdateManifestPlatform {
  url: string;
  sha256: string;
}

export interface UpdateManifest {
  version: string;
  url: string;
  sha256: string;
  platforms?: Record<string, UpdateManifestPlatform>;
  releaseNotes?: string;
  publishedAt?: number;
}

export type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "applying"
  | "error";

export interface UpdaterStatus {
  state: UpdaterState;
  current: string;
  latest?: UpdateManifest;
  error?: string;
  progress?: { bytes: number; total: number };
}

export interface UpdaterEvents {
  onStatus: (status: UpdaterStatus) => void;
  onProgress: (bytes: number, total: number) => void;
  onReady: (version: string) => void;
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function rccDir(): string {
  return join(homedir(), ".rcc");
}

function updatesDir(): string {
  return join(rccDir(), "updates");
}

function installDir(): string {
  return join(rccDir(), "install");
}

function binSymlinkPath(): string {
  return join(homedir(), ".local", "bin", "rcc");
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10));
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const bi = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function parseManifest(body: unknown): UpdateManifest | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const tag = typeof obj.tag_name === "string" ? obj.tag_name : undefined;
  const ver = typeof obj.version === "string" ? obj.version : undefined;
  const version = (tag ?? ver)?.replace(/^v/, "");
  if (!version) return null;
  const url = typeof obj.url === "string" ? obj.url : "";
  const sha256 = typeof obj.sha256 === "string" ? obj.sha256 : "";
  if (!url || !sha256) return null;
  const platforms =
    obj.platforms && typeof obj.platforms === "object"
      ? Object.fromEntries(
          Object.entries(obj.platforms as Record<string, unknown>).flatMap(([k, v]) => {
            if (!v || typeof v !== "object") return [] as [string, UpdateManifestPlatform][];
            const pv = v as Record<string, unknown>;
            if (typeof pv.url !== "string" || typeof pv.sha256 !== "string") return [];
            return [[k, { url: pv.url, sha256: pv.sha256 }]];
          }),
        )
      : undefined;
  const notes =
    typeof obj.releaseNotes === "string"
      ? obj.releaseNotes
      : typeof obj.body === "string"
        ? obj.body
        : typeof obj.notes === "string"
          ? obj.notes
          : undefined;
  const publishedAt =
    typeof obj.publishedAt === "number"
      ? obj.publishedAt
      : typeof obj.published_at === "string"
        ? Date.parse(obj.published_at) || undefined
        : undefined;
  return { version, url, sha256, platforms, releaseNotes: notes, publishedAt };
}

async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

async function extractTarGz(archive: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await execFileP("tar", ["-xzf", archive, "-C", target, "--strip-components=1"], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

export class Updater {
  private status: UpdaterStatus;
  private abortCtrl: AbortController | null = null;
  private handlers: Partial<UpdaterEvents> = {};
  private downloadPath: string | null = null;
  private extractedPath: string | null = null;
  private lastCheckAt = 0;

  constructor(current: string) {
    this.status = { state: "idle", current };
  }

  static async create(): Promise<Updater> {
    return new Updater(await getCurrentVersion());
  }

  getStatus(): UpdaterStatus {
    return { ...this.status, progress: this.status.progress ? { ...this.status.progress } : undefined };
  }

  setHandlers(h: Partial<UpdaterEvents>): void {
    this.handlers = { ...this.handlers, ...h };
  }

  private emit(): void {
    this.handlers.onStatus?.(this.getStatus());
  }

  private setState(state: UpdaterState, extra: Partial<UpdaterStatus> = {}): void {
    this.status = { ...this.status, state, ...extra };
    this.emit();
  }

  async check(force = false): Promise<UpdaterStatus> {
    const now = Date.now();
    if (!force && this.status.state === "downloading") return this.getStatus();
    if (!force && now - this.lastCheckAt < 30_000 && this.status.state !== "idle") {
      return this.getStatus();
    }
    this.lastCheckAt = now;
    const cfg = await loadConfig();
    const update = (cfg as { update?: { manifestUrl?: string } }).update;
    const manifestUrl = typeof update?.manifestUrl === "string" ? update.manifestUrl.trim() : "";
    if (!manifestUrl) {
      this.setState("idle", { error: undefined, latest: undefined });
      return this.getStatus();
    }
    this.setState("checking");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const resp = await fetch(manifestUrl, {
        headers: { accept: "application/json", "user-agent": "rcc-host" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        this.setState("error", { error: `HTTP ${resp.status}` });
        return this.getStatus();
      }
      const body = await resp.json();
      const parsed = parseManifest(body);
      if (!parsed) {
        this.setState("error", { error: "manifest missing version/url/sha256" });
        return this.getStatus();
      }
      const cmp = compareSemver(parsed.version, this.status.current.replace(/^v/, ""));
      if (cmp > 0) {
        this.setState("available", { latest: parsed, error: undefined });
      } else {
        this.setState("idle", { latest: parsed, error: undefined });
      }
      return this.getStatus();
    } catch (err: any) {
      this.setState("error", { error: err?.message ?? String(err) });
      return this.getStatus();
    }
  }

  private resolveAsset(): { url: string; sha256: string } | null {
    const m = this.status.latest;
    if (!m) return null;
    const key = platformKey();
    const byPlatform = m.platforms?.[key];
    if (byPlatform) return { url: byPlatform.url, sha256: byPlatform.sha256 };
    if (m.url && m.sha256) return { url: m.url, sha256: m.sha256 };
    return null;
  }

  async download(): Promise<UpdaterStatus> {
    if (this.status.state === "downloading") return this.getStatus();
    if (!this.status.latest) {
      this.setState("error", { error: "no update available" });
      return this.getStatus();
    }
    const asset = this.resolveAsset();
    if (!asset) {
      this.setState("error", { error: `no asset for platform ${platformKey()}` });
      return this.getStatus();
    }
    await mkdir(updatesDir(), { recursive: true });
    const version = this.status.latest.version;
    const finalPath = join(updatesDir(), `rcc-${version}-${platformKey()}.tar.gz`);
    const tmpPath = `${finalPath}.part`;
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
    this.abortCtrl = new AbortController();
    this.setState("downloading", { progress: { bytes: 0, total: 0 }, error: undefined });
    try {
      const resp = await fetch(asset.url, {
        headers: { "user-agent": "rcc-host", accept: "application/octet-stream" },
        signal: this.abortCtrl.signal,
        redirect: "follow",
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const total = Number(resp.headers.get("content-length") ?? "0");
      const hash = createHash("sha256");
      let bytes = 0;
      // reason: Readable.fromWeb's types vary across node versions; resp.body is a web ReadableStream
      const nodeStream = Readable.fromWeb(resp.body as unknown as import("node:stream/web").ReadableStream);
      const out = createWriteStream(tmpPath);
      let lastEmit = 0;
      nodeStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
        const now = Date.now();
        if (now - lastEmit > 200) {
          lastEmit = now;
          this.status.progress = { bytes, total };
          this.handlers.onProgress?.(bytes, total);
        }
      });
      await pipeline(nodeStream, out);
      const digest = hash.digest("hex");
      if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
        await unlink(tmpPath).catch(() => {});
        throw new Error(`sha256 mismatch: got ${digest}, expected ${asset.sha256}`);
      }
      await rename(tmpPath, finalPath);
      this.downloadPath = finalPath;
      this.status.progress = { bytes, total: total || bytes };
      this.handlers.onProgress?.(bytes, total || bytes);
      this.setState("downloaded", { error: undefined });
      return this.getStatus();
    } catch (err: any) {
      try {
        await unlink(tmpPath);
      } catch {
        // ignore
      }
      const msg = err?.name === "AbortError" ? "下载已取消" : err?.message ?? String(err);
      this.setState("error", { error: msg });
      return this.getStatus();
    } finally {
      this.abortCtrl = null;
    }
  }

  abortDownload(): void {
    this.abortCtrl?.abort();
  }

  async apply(): Promise<UpdaterStatus> {
    if (this.status.state !== "downloaded" || !this.downloadPath || !this.status.latest) {
      this.setState("error", { error: "nothing to apply" });
      return this.getStatus();
    }
    this.setState("applying");
    const version = this.status.latest.version;
    const stagingRoot = join(installDir(), `rcc-${version}.staging-${process.pid}`);
    const finalRoot = join(installDir(), `rcc-${version}`);
    try {
      try {
        await rm(stagingRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await mkdir(installDir(), { recursive: true });
      await extractTarGz(this.downloadPath, stagingRoot);
      try {
        await rm(finalRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await rename(stagingRoot, finalRoot);
      this.extractedPath = finalRoot;

      const binTarget = join(finalRoot, "bin", "rcc");
      try {
        await stat(binTarget);
      } catch {
        // no bin/rcc inside tarball — skip symlink but don't fail; user may run from source
      }
      const linkPath = binSymlinkPath();
      try {
        await mkdir(dirname(linkPath), { recursive: true });
        try {
          const current = await readlink(linkPath);
          if (current !== binTarget) {
            await unlink(linkPath);
            await symlink(binTarget, linkPath);
          }
        } catch {
          try {
            await unlink(linkPath);
          } catch {
            // ignore (didn't exist)
          }
          await symlink(binTarget, linkPath);
        }
      } catch (err: any) {
        // symlink is best-effort; log but don't abort
        console.warn(`[updater] symlink update failed: ${err?.message ?? err}`);
      }

      this.handlers.onReady?.(version);
      this.setState("idle", { error: undefined });

      // Give the emit loop one tick to flush the update.ready + status frames
      // to connected ws clients before the process exits.
      setTimeout(() => {
        process.exit(0);
      }, 800);
      return this.getStatus();
    } catch (err: any) {
      try {
        await rm(stagingRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this.setState("error", { error: err?.message ?? String(err) });
      return this.getStatus();
    }
  }
}
