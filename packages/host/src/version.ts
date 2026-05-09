import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const HOST_PKG = resolve(HERE, "..", "package.json");
const HOST_MAIN = resolve(HERE, "index.ts");

let cachedVersion: string | null = null;

export async function getCurrentVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const raw = await readFile(HOST_PKG, "utf8");
    const pkg = JSON.parse(raw);
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion ?? "0.0.0";
}

export async function getBuildTime(): Promise<number> {
  try {
    const st = await stat(HOST_MAIN);
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

interface CheckCache {
  at: number;
  result: CheckResult;
}

export type CheckResult =
  | { configured: false }
  | { configured: true; available: boolean; current: string; latest: string; notes?: string; url?: string }
  | { configured: true; error: string; current: string };

const CACHE_TTL = 10 * 60 * 1000;
let cache: CheckCache | null = null;

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

function parseManifest(body: unknown): { version: string; notes?: string; url?: string } | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const tag = typeof obj.tag_name === "string" ? obj.tag_name : undefined;
  const ver = typeof obj.version === "string" ? obj.version : undefined;
  const version = tag ?? ver;
  if (!version) return null;
  const notes = typeof obj.body === "string" ? obj.body : typeof obj.notes === "string" ? obj.notes : undefined;
  const url = typeof obj.html_url === "string" ? obj.html_url : typeof obj.url === "string" ? obj.url : undefined;
  return { version, notes, url };
}

export async function checkForUpdates(force = false): Promise<CheckResult> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL) return cache.result;

  const cfg = await loadConfig();
  const update = (cfg as { update?: { manifestUrl?: string } }).update;
  const manifestUrl = typeof update?.manifestUrl === "string" ? update.manifestUrl.trim() : "";
  const current = await getCurrentVersion();

  if (!manifestUrl) {
    const result: CheckResult = { configured: false };
    cache = { at: now, result };
    return result;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(manifestUrl, {
      headers: { accept: "application/json", "user-agent": "rcc-host" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const result: CheckResult = { configured: true, error: `HTTP ${resp.status}`, current };
      cache = { at: now, result };
      return result;
    }
    const body = await resp.json();
    const parsed = parseManifest(body);
    if (!parsed) {
      const result: CheckResult = { configured: true, error: "manifest missing tag_name/version", current };
      cache = { at: now, result };
      return result;
    }
    const cleanLatest = parsed.version.replace(/^v/, "");
    const cleanCur = current.replace(/^v/, "");
    const available = compareSemver(cleanLatest, cleanCur) > 0;
    const result: CheckResult = {
      configured: true,
      available,
      current,
      latest: parsed.version,
      notes: parsed.notes,
      url: parsed.url,
    };
    cache = { at: now, result };
    return result;
  } catch (err: any) {
    const result: CheckResult = {
      configured: true,
      error: err?.message ?? String(err),
      current,
    };
    cache = { at: now, result };
    return result;
  }
}

export function clearUpdateCache(): void {
  cache = null;
}

export async function versionSummary(): Promise<{ version: string; buildTime: number; node: string }> {
  return {
    version: await getCurrentVersion(),
    buildTime: await getBuildTime(),
    node: process.version,
  };
}
