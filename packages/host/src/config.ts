import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";

export type TunnelMode = "off" | "try" | "named";

export interface TunnelConfig {
  mode: TunnelMode;
  name?: string;
  hostname?: string;
  credentialsFile?: string;
}

export interface RccConfig {
  tunnel?: {
    mode?: string;
    name?: string;
    hostname?: string;
    credentialsFile?: string;
  };
  [key: string]: unknown;
}

export function configPath(): string {
  return join(homedir(), ".rcc", "config.json");
}

export function expandUser(p: string | undefined): string | undefined {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export async function loadConfig(): Promise<RccConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as RccConfig;
    return {};
  } catch (err: any) {
    if (err?.code === "ENOENT") return {};
    console.warn(`[rcc-host] failed to read ${configPath()}: ${err?.message ?? err}`);
    return {};
  }
}

/**
 * Resolve effective tunnel config by combining env (RCC_TUNNEL) + ~/.rcc/config.json.
 * Env wins over config; config wins over defaults.
 */
export function resolveTunnelConfig(cfg: RccConfig, env: NodeJS.ProcessEnv): TunnelConfig {
  const envRaw = (env.RCC_TUNNEL ?? "").toLowerCase().trim();
  const cfgMode = (cfg.tunnel?.mode ?? "").toLowerCase().trim();

  let mode: TunnelMode = "off";
  if (envRaw === "named" || (envRaw === "" && cfgMode === "named")) {
    mode = "named";
  } else if (envRaw === "1" || envRaw === "true" || envRaw === "try" || (envRaw === "" && (cfgMode === "1" || cfgMode === "true" || cfgMode === "try"))) {
    mode = "try";
  } else if (envRaw === "0" || envRaw === "false" || envRaw === "off" || (envRaw === "" && cfgMode === "off")) {
    mode = "off";
  }

  const credFile = expandUser(cfg.tunnel?.credentialsFile);
  return {
    mode,
    name: cfg.tunnel?.name,
    hostname: cfg.tunnel?.hostname,
    credentialsFile: credFile && !isAbsolute(credFile) ? join(homedir(), credFile) : credFile,
  };
}
