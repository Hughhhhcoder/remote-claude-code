import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const execFileP = promisify(execFile);

export type McpScope = "local" | "user" | "project";
export type McpTransport = "stdio" | "sse" | "http";
export type McpStatus = "ready" | "failed" | "disabled" | "unknown";

export interface McpServerSummary {
  name: string;
  transport: McpTransport;
  scope: McpScope;
  status: McpStatus;
  commandOrUrl: string;
  disabled: boolean;
  statusMessage?: string;
  toolCount?: number;
}

export interface McpEnvPair {
  key: string;
  /** Masked value for transport; always `***` if secret-looking or when redacted. */
  value: string;
  isSecret: boolean;
  /** Length of the original value (useful so UI can show "12 chars hidden"). */
  length: number;
}

export interface McpServerDetail extends McpServerSummary {
  command?: string;
  args?: string[];
  url?: string;
  env: McpEnvPair[];
  rawStatus: string;
}

export interface McpAddInput {
  name: string;
  transport: McpTransport;
  scope: McpScope;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** For http/sse: optional headers */
  headers?: Record<string, string>;
}

const CLAUDE_CMD = process.env.RCC_CLAUDE_CMD ?? "claude";
const DISABLED_PATH = join(homedir(), ".rcc", "mcp-disabled.json");

interface DisabledStoreFile {
  version: 1;
  servers: Record<string, StoredDisabledServer>;
}

interface StoredDisabledServer {
  name: string;
  transport: McpTransport;
  scope: McpScope;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabledAt: number;
}

// ─── Secret masking ───────────────────────────────────────────────────────
const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH|API[_-]?KEY)/i;

function isSecretKey(k: string): boolean {
  return SECRET_KEY_RE.test(k);
}

function maskEnv(env: Record<string, string> | undefined): McpEnvPair[] {
  if (!env) return [];
  return Object.entries(env).map(([key, val]) => {
    const secret = isSecretKey(key);
    return {
      key,
      value: secret ? "***" : val,
      isSecret: secret,
      length: val.length,
    };
  });
}

// ─── Disabled store ───────────────────────────────────────────────────────
async function loadDisabled(): Promise<DisabledStoreFile> {
  try {
    const raw = await readFile(DISABLED_PATH, "utf8");
    const parsed = JSON.parse(raw) as DisabledStoreFile;
    if (parsed.version !== 1 || !parsed.servers) {
      return { version: 1, servers: {} };
    }
    return parsed;
  } catch {
    return { version: 1, servers: {} };
  }
}

async function saveDisabled(data: DisabledStoreFile): Promise<void> {
  await mkdir(dirname(DISABLED_PATH), { recursive: true });
  const tmp = DISABLED_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(tmp, DISABLED_PATH);
}

// ─── CLI wrappers ─────────────────────────────────────────────────────────
async function runClaude(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const res = await execFileP(CLAUDE_CMD, args, {
      cwd: cwd ?? process.cwd(),
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    return { stdout: res.stdout.toString(), stderr: res.stderr.toString() };
  } catch (err: any) {
    // execFile throws on non-zero exit; propagate but attach stdout/stderr if
    // present so the caller can surface useful messages.
    const e: any = new Error(err.message ?? String(err));
    e.stdout = err.stdout?.toString() ?? "";
    e.stderr = err.stderr?.toString() ?? "";
    e.code = err.code;
    throw e;
  }
}

// `claude mcp list` output looks like:
//   Checking MCP server health…
//
//   tavily: /opt/homebrew/bin/npx -y tavily-mcp@latest - ✓ Connected
//   github: https://mcp.github.com/sse - ✗ Failed to connect: ...
//
// Older/newer versions vary slightly; we do a permissive parse.
function parseListOutput(text: string): Array<Pick<McpServerSummary, "name" | "commandOrUrl" | "status" | "statusMessage" | "transport">> {
  const out: Array<Pick<McpServerSummary, "name" | "commandOrUrl" | "status" | "statusMessage" | "transport">> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^checking mcp/i.test(line)) continue;
    if (/^no mcp servers/i.test(line)) continue;
    // match:  name: <rest> - <status>
    const m = line.match(/^([A-Za-z0-9_.\-@:]+):\s+(.+?)\s+-\s+(.+)$/);
    if (!m) continue;
    const [, name, commandOrUrl, statusRaw] = m;
    const statusText = statusRaw!.trim();
    let status: McpStatus = "unknown";
    if (/connected|ready|ok/i.test(statusText)) status = "ready";
    else if (/fail|error|disconnect/i.test(statusText)) status = "failed";
    const transport: McpTransport = /^https?:\/\//.test(commandOrUrl!.trim())
      ? "http"
      : "stdio";
    out.push({
      name: name!,
      commandOrUrl: commandOrUrl!.trim(),
      status,
      statusMessage: statusText,
      transport,
    });
  }
  return out;
}

// `claude mcp get <name>` output example:
//   tavily:
//     Scope: User config (available in all your projects)
//     Status: ✓ Connected
//     Type: stdio
//     Command: /opt/homebrew/bin/npx
//     Args: -y tavily-mcp@latest
//     Environment:
//       TAVILY_API_KEY=tvly-xxx
interface ParsedGet {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  status: McpStatus;
  statusMessage: string;
}

function parseGetOutput(text: string, fallbackName: string): ParsedGet {
  const lines = text.split(/\r?\n/);
  const parsed: ParsedGet = {
    name: fallbackName,
    scope: "local",
    transport: "stdio",
    env: {},
    status: "unknown",
    statusMessage: "",
  };
  let envMode = false;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed) {
      envMode = false;
      continue;
    }
    const nameMatch = line.match(/^([A-Za-z0-9_.\-@:]+):\s*$/);
    if (nameMatch && !line.startsWith(" ")) {
      parsed.name = nameMatch[1]!;
      continue;
    }
    if (envMode && /^\s{2,}/.test(line)) {
      const kv = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (kv) {
        parsed.env[kv[1]!] = kv[2]!;
        continue;
      }
    }
    envMode = false;
    if (/^Scope:/i.test(trimmed)) {
      const rest = trimmed.slice(trimmed.indexOf(":") + 1).trim().toLowerCase();
      if (rest.startsWith("user")) parsed.scope = "user";
      else if (rest.startsWith("project")) parsed.scope = "project";
      else parsed.scope = "local";
      continue;
    }
    if (/^Status:/i.test(trimmed)) {
      const rest = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      parsed.statusMessage = rest;
      if (/connected|ready|ok/i.test(rest)) parsed.status = "ready";
      else if (/fail|error/i.test(rest)) parsed.status = "failed";
      continue;
    }
    if (/^Type:/i.test(trimmed)) {
      const rest = trimmed.slice(trimmed.indexOf(":") + 1).trim().toLowerCase();
      if (rest === "http" || rest === "sse" || rest === "stdio") parsed.transport = rest;
      continue;
    }
    if (/^Command:/i.test(trimmed)) {
      parsed.command = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      continue;
    }
    if (/^Args:/i.test(trimmed)) {
      const rest = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      parsed.args = rest.length ? rest.split(/\s+/) : [];
      continue;
    }
    if (/^URL:/i.test(trimmed)) {
      parsed.url = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      continue;
    }
    if (/^Environment:/i.test(trimmed)) {
      envMode = true;
      continue;
    }
  }
  return parsed;
}

// ─── Public API ───────────────────────────────────────────────────────────
export async function listMcp(cwd?: string): Promise<McpServerSummary[]> {
  let active: Array<Pick<McpServerSummary, "name" | "commandOrUrl" | "status" | "statusMessage" | "transport">> = [];
  try {
    const { stdout } = await runClaude(["mcp", "list"], cwd);
    active = parseListOutput(stdout);
  } catch (err: any) {
    const out = (err.stdout ?? "") + (err.stderr ?? "");
    if (out) active = parseListOutput(out);
    else console.warn("[rcc-host] mcp list failed:", err.message);
  }

  const disabled = await loadDisabled();

  // Enrich with scope via `claude mcp get` (best-effort, parallel).
  const enriched = await Promise.all(
    active.map(async (a) => {
      let scope: McpScope = "local";
      try {
        const { stdout } = await runClaude(["mcp", "get", a.name], cwd);
        const parsed = parseGetOutput(stdout, a.name);
        scope = parsed.scope;
      } catch {
        // keep default
      }
      const summary: McpServerSummary = {
        name: a.name,
        transport: a.transport,
        scope,
        status: a.status,
        commandOrUrl: a.commandOrUrl,
        disabled: false,
        statusMessage: a.statusMessage,
      };
      return summary;
    }),
  );

  // Add disabled servers (kept in our cache but not registered with claude).
  for (const [name, d] of Object.entries(disabled.servers)) {
    if (enriched.find((x) => x.name === name)) continue;
    enriched.push({
      name,
      transport: d.transport,
      scope: d.scope,
      status: "disabled",
      commandOrUrl: d.url ?? [d.command ?? "", ...(d.args ?? [])].join(" ").trim(),
      disabled: true,
      statusMessage: "disabled",
    });
  }

  enriched.sort((a, b) => a.name.localeCompare(b.name));
  return enriched;
}

export async function getMcp(name: string, cwd?: string): Promise<McpServerDetail | null> {
  const disabled = await loadDisabled();
  const disabledEntry = disabled.servers[name];

  let parsed: ParsedGet | null = null;
  try {
    const { stdout } = await runClaude(["mcp", "get", name], cwd);
    parsed = parseGetOutput(stdout, name);
  } catch (err: any) {
    if (!disabledEntry) {
      const msg = err.stderr || err.message || "not found";
      if (/no such|not found|unknown/i.test(msg)) return null;
      throw err;
    }
  }

  if (!parsed && disabledEntry) {
    return {
      name: disabledEntry.name,
      transport: disabledEntry.transport,
      scope: disabledEntry.scope,
      status: "disabled",
      commandOrUrl: disabledEntry.url ?? [disabledEntry.command ?? "", ...(disabledEntry.args ?? [])].join(" ").trim(),
      disabled: true,
      statusMessage: "disabled",
      command: disabledEntry.command,
      args: disabledEntry.args,
      url: disabledEntry.url,
      env: maskEnv(disabledEntry.env),
      rawStatus: "disabled",
    };
  }

  if (!parsed) return null;
  const commandOrUrl = parsed.url ?? [parsed.command ?? "", ...(parsed.args ?? [])].join(" ").trim();
  return {
    name: parsed.name,
    transport: parsed.transport,
    scope: parsed.scope,
    status: parsed.status,
    commandOrUrl,
    disabled: false,
    statusMessage: parsed.statusMessage,
    command: parsed.command,
    args: parsed.args,
    url: parsed.url,
    env: maskEnv(parsed.env),
    rawStatus: parsed.statusMessage,
  };
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9_.\-]{1,64}$/.test(name)) {
    throw new Error(`invalid server name: ${name}`);
  }
}

export async function addMcp(input: McpAddInput, cwd?: string): Promise<void> {
  validateName(input.name);
  const args: string[] = ["mcp", "add", "-s", input.scope];
  if (input.transport !== "stdio") {
    args.push("-t", input.transport);
  }
  // The CLI's `-e KEY=VAL` option is variadic and consumes subsequent args
  // until it hits a non `KEY=VAL` token, so we MUST put the server name
  // before -e/-H, then those flags, then `--` separator, then the command.
  if (input.transport === "stdio") {
    if (!input.command) throw new Error("stdio transport requires a command");
    args.push(input.name);
    if (input.env) {
      for (const [k, v] of Object.entries(input.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          throw new Error(`invalid env name: ${k}`);
        }
        args.push("-e", `${k}=${v}`);
      }
    }
    args.push("--", input.command);
    if (input.args && input.args.length) args.push(...input.args);
  } else {
    if (!input.url) throw new Error(`${input.transport} transport requires a url`);
    args.push(input.name, input.url);
    if (input.env) {
      for (const [k, v] of Object.entries(input.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          throw new Error(`invalid env name: ${k}`);
        }
        args.push("-e", `${k}=${v}`);
      }
    }
    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        args.push("-H", `${k}: ${v}`);
      }
    }
  }
  await runClaude(args, cwd);
  // If this name was previously disabled, clear that record.
  const disabled = await loadDisabled();
  if (disabled.servers[input.name]) {
    delete disabled.servers[input.name];
    await saveDisabled(disabled);
  }
}

export async function removeMcp(name: string, scope?: McpScope, cwd?: string): Promise<void> {
  validateName(name);
  const args = ["mcp", "remove"];
  if (scope) args.push("-s", scope);
  args.push(name);
  try {
    await runClaude(args, cwd);
  } catch (err: any) {
    // if the CLI says "not found" and it's in our disabled cache, that's fine
    const disabled = await loadDisabled();
    if (disabled.servers[name]) {
      delete disabled.servers[name];
      await saveDisabled(disabled);
      return;
    }
    throw err;
  }
  // also clear from disabled cache if present
  const disabled = await loadDisabled();
  if (disabled.servers[name]) {
    delete disabled.servers[name];
    await saveDisabled(disabled);
  }
}

/**
 * Toggle a server's enabled state. Since `claude mcp` has no native
 * enable/disable, we implement disable as: snapshot the full config to
 * ~/.rcc/mcp-disabled.json, then `claude mcp remove`. Enable re-runs
 * `claude mcp add` with the stored config.
 */
export async function setMcpEnabled(
  name: string,
  enabled: boolean,
  realEnv: Record<string, string> | null,
  cwd?: string,
): Promise<void> {
  validateName(name);
  const disabled = await loadDisabled();
  if (enabled) {
    const entry = disabled.servers[name];
    if (!entry) {
      // nothing to do; already enabled (or unknown)
      return;
    }
    await addMcp(
      {
        name: entry.name,
        transport: entry.transport,
        scope: entry.scope,
        command: entry.command,
        args: entry.args,
        url: entry.url,
        env: entry.env,
        headers: entry.headers,
      },
      cwd,
    );
    delete disabled.servers[name];
    await saveDisabled(disabled);
    return;
  }

  // Disabling: fetch current config so we can restore later.
  const detail = await getMcp(name, cwd);
  if (!detail) throw new Error(`unknown server: ${name}`);
  if (detail.disabled) return;

  // Real env values aren't available from the detail (they're masked in the
  // public shape). The caller (handler) must supply real values for any secret
  // env keys the user wants to preserve. For non-secret keys we have the
  // plaintext from getMcp internally. We re-read the raw env via a fresh
  // `claude mcp get` so non-secret values round-trip.
  const { stdout } = await runClaude(["mcp", "get", name], cwd);
  const parsed = parseGetOutput(stdout, name);
  const env: Record<string, string> = { ...parsed.env };
  if (realEnv) {
    for (const [k, v] of Object.entries(realEnv)) env[k] = v;
  }

  const entry: StoredDisabledServer = {
    name: detail.name,
    transport: detail.transport,
    scope: detail.scope,
    command: detail.command,
    args: detail.args,
    url: detail.url,
    env,
    disabledAt: Date.now(),
  };
  disabled.servers[name] = entry;
  await saveDisabled(disabled);
  // Now remove from claude.
  await removeMcp(name, detail.scope, cwd);
  // Re-save in case removeMcp cleared our entry (it does, if it saw it first).
  const after = await loadDisabled();
  after.servers[name] = entry;
  await saveDisabled(after);
}
