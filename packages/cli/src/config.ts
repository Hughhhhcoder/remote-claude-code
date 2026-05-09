import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface Profile {
  url: string;
  token: string;
}

export interface CliConfig {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

const CONFIG_DIR = join(homedir(), ".rcc");
const CONFIG_PATH = join(CONFIG_DIR, "cli-config.json");

function emptyConfig(): CliConfig {
  return { defaultProfile: "", profiles: {} };
}

export async function loadConfig(): Promise<CliConfig> {
  try {
    const text = await fs.readFile(CONFIG_PATH, "utf8");
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object") return emptyConfig();
    const obj = raw as Partial<CliConfig>;
    const profiles: Record<string, Profile> = {};
    if (obj.profiles && typeof obj.profiles === "object") {
      for (const [k, v] of Object.entries(obj.profiles)) {
        if (v && typeof v === "object") {
          const p = v as Partial<Profile>;
          if (typeof p.url === "string" && typeof p.token === "string") {
            profiles[k] = { url: p.url, token: p.token };
          }
        }
      }
    }
    return {
      defaultProfile: typeof obj.defaultProfile === "string" ? obj.defaultProfile : "",
      profiles,
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return emptyConfig();
    throw err;
  }
}

export async function saveConfig(cfg: CliConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = CONFIG_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.rename(tmp, CONFIG_PATH);
  try {
    await fs.chmod(CONFIG_PATH, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

export function resolveProfile(cfg: CliConfig, name?: string): Profile {
  const key = name ?? cfg.defaultProfile;
  if (!key) {
    throw new Error("no profile configured; run `rcc login` first");
  }
  const p = cfg.profiles[key];
  if (!p) {
    throw new Error(`unknown profile: ${key}`);
  }
  return p;
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function configDir(): string {
  return dirname(CONFIG_PATH);
}
