import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { Frame, PluginInfo, PluginPermission, SessionMeta } from "@rcc/protocol";
import { PluginPermission as PluginPermissionSchema } from "@rcc/protocol";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  ui?: string;
  permissions?: PluginPermission[];
}

export interface SessionMetaLite {
  id: string;
  cwd: string;
  title?: string;
  status: "running" | "exited";
  projectId?: string;
}

export type PluginBroadcastFrame = {
  kind: string;
  payload?: unknown;
};

export interface PluginContext {
  id: string;
  log: (msg: string) => void;
  broadcast: (frame: PluginBroadcastFrame) => void;
  onSessionCreated: (cb: (session: SessionMetaLite) => void) => () => void;
  onSessionExited: (cb: (sid: string) => void) => () => void;
}

export interface PluginCallContext {
  id: string;
  log: (msg: string) => void;
  hasPermission: (p: PluginPermission) => boolean;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  onLoad?: (ctx: PluginContext) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
  handleCall?: (
    method: string,
    payload: unknown,
    ctx: PluginCallContext,
  ) => Promise<unknown> | unknown;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: Plugin;
  dir: string;
  disposers: Array<() => void>;
  error: string | null;
}

function defaultPluginsRoot(): string {
  return join(homedir(), ".rcc", "plugins");
}

function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return ID_RE.test(raw) ? raw : null;
}

function parsePermissions(raw: unknown): PluginPermission[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginPermission[] = [];
  for (const item of raw) {
    const parsed = PluginPermissionSchema.safeParse(item);
    if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data);
  }
  return out;
}

function parseManifest(raw: unknown, dir: string): PluginManifest | string {
  if (!raw || typeof raw !== "object") return "manifest is not an object";
  const r = raw as Record<string, unknown>;
  const id = sanitizeId(r.id);
  if (!id) return "invalid or missing id (must match [a-z0-9-]+)";
  if (typeof r.name !== "string" || !r.name.trim()) return "missing name";
  if (typeof r.version !== "string" || !VERSION_RE.test(r.version)) return "invalid version";
  if (typeof r.entry !== "string" || !r.entry.trim()) return "missing entry";
  if (isAbsolute(r.entry)) return "entry must be relative to plugin dir";
  const entryResolved = resolve(dir, r.entry);
  if (!entryResolved.startsWith(resolve(dir) + "/") && entryResolved !== resolve(dir, r.entry)) {
    // fallthrough — defense-in-depth check below
  }
  const rel = relative(dir, entryResolved);
  if (rel.startsWith("..") || isAbsolute(rel)) return "entry escapes plugin dir";
  let ui: string | undefined;
  if (typeof r.ui === "string" && r.ui.trim()) {
    const uiRel = relative(dir, resolve(dir, r.ui));
    if (uiRel.startsWith("..") || isAbsolute(uiRel)) return "ui escapes plugin dir";
    ui = r.ui;
  }
  const permissions = parsePermissions(r.permissions);
  return {
    id,
    name: r.name.trim().slice(0, 80),
    version: r.version,
    entry: r.entry,
    ui,
    permissions,
  };
}

function validatePlugin(p: unknown, manifest: PluginManifest): Plugin | string {
  if (!p || typeof p !== "object") return "plugin default export is not an object";
  const obj = p as Partial<Plugin>;
  if (obj.id !== manifest.id) return `plugin.id "${obj.id}" !== manifest.id "${manifest.id}"`;
  if (typeof obj.name !== "string") return "plugin.name missing";
  if (typeof obj.version !== "string") return "plugin.version missing";
  return obj as Plugin;
}

export interface PluginHostDeps {
  listSessions: () => SessionMeta[];
  broadcastFrame: (frame: Frame) => void;
  onSessionCreatedBus: {
    subscribe: (cb: (s: SessionMeta) => void) => () => void;
  };
  onSessionExitedBus: {
    subscribe: (cb: (sid: string) => void) => () => void;
  };
}

/** Lightweight pub/sub used to hand session events out to plugin contexts. */
export class PluginEventBus<T> {
  private readonly listeners = new Set<(value: T) => void>();
  subscribe(cb: (value: T) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(value: T): void {
    for (const l of [...this.listeners]) {
      try {
        l(value);
      } catch (err) {
        console.warn("[plugins] event listener threw:", err);
      }
    }
  }
}

export class PluginHost {
  private readonly root: string;
  private readonly deps: PluginHostDeps;
  private readonly loaded = new Map<string, LoadedPlugin>();

  constructor(deps: PluginHostDeps, root = defaultPluginsRoot()) {
    this.root = root;
    this.deps = deps;
  }

  async loadAll(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!ID_RE.test(name)) continue;
      const dir = join(this.root, name);
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      await this.loadOne(dir).catch((err) => {
        console.warn(`[plugins] ${name} load failed:`, err?.message ?? err);
      });
    }
  }

  private async loadOne(dir: string): Promise<void> {
    const normDir = normalize(dir);
    const rootNorm = normalize(this.root);
    if (!normDir.startsWith(rootNorm)) {
      console.warn(`[plugins] refusing to load out-of-tree dir ${dir}`);
      return;
    }
    const manifestPath = join(dir, "manifest.json");
    let manifestRaw: unknown;
    try {
      const text = await readFile(manifestPath, "utf8");
      manifestRaw = JSON.parse(text);
    } catch (err: any) {
      console.warn(`[plugins] ${dir} manifest.json unreadable:`, err?.message ?? err);
      return;
    }
    const manifestOrErr = parseManifest(manifestRaw, dir);
    if (typeof manifestOrErr === "string") {
      console.warn(`[plugins] ${dir} manifest invalid:`, manifestOrErr);
      return;
    }
    const manifest = manifestOrErr;
    if (this.loaded.has(manifest.id)) {
      console.warn(`[plugins] duplicate id "${manifest.id}" — skipping second copy`);
      return;
    }

    const entryPath = resolve(dir, manifest.entry);
    const rel = relative(dir, entryPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      console.warn(`[plugins] ${manifest.id} entry escapes dir, refusing`);
      return;
    }

    let mod: any;
    try {
      mod = await import(pathToFileURL(entryPath).href);
    } catch (err: any) {
      console.warn(`[plugins] ${manifest.id} dynamic import failed:`, err?.message ?? err);
      this.loaded.set(manifest.id, {
        manifest,
        plugin: { id: manifest.id, name: manifest.name, version: manifest.version },
        dir,
        disposers: [],
        error: `import failed: ${err?.message ?? String(err)}`,
      });
      return;
    }
    const exported = mod?.default ?? mod?.plugin ?? mod;
    const pluginOrErr = validatePlugin(exported, manifest);
    if (typeof pluginOrErr === "string") {
      console.warn(`[plugins] ${manifest.id}:`, pluginOrErr);
      this.loaded.set(manifest.id, {
        manifest,
        plugin: { id: manifest.id, name: manifest.name, version: manifest.version },
        dir,
        disposers: [],
        error: pluginOrErr,
      });
      return;
    }
    const plugin = pluginOrErr;
    const entry: LoadedPlugin = { manifest, plugin, dir, disposers: [], error: null };
    this.loaded.set(manifest.id, entry);

    const ctx = this.makeContext(entry);
    if (plugin.onLoad) {
      try {
        await plugin.onLoad(ctx);
      } catch (err: any) {
        console.warn(`[plugins] ${manifest.id} onLoad threw:`, err?.message ?? err);
        entry.error = `onLoad: ${err?.message ?? String(err)}`;
      }
    }
    console.log(`[plugins] loaded ${manifest.id}@${manifest.version}`);
  }

  private makeContext(entry: LoadedPlugin): PluginContext {
    const { manifest } = entry;
    const has = (p: PluginPermission) => (manifest.permissions ?? []).includes(p);
    return {
      id: manifest.id,
      log: (msg: string) => console.log(`[plugin:${manifest.id}] ${msg}`),
      broadcast: (frame) => {
        if (!has("broadcast")) {
          console.warn(`[plugins] ${manifest.id} broadcast denied (no permission)`);
          return;
        }
        this.deps.broadcastFrame({
          v: 1,
          t: "plugin.broadcast",
          pluginId: manifest.id,
          kind: String(frame.kind).slice(0, 64),
          payload: frame.payload,
        });
      },
      onSessionCreated: (cb) => {
        if (!has("session:read")) {
          return () => {};
        }
        const dispose = this.deps.onSessionCreatedBus.subscribe((s) => {
          try {
            cb(sessionMetaLite(s));
          } catch (err: any) {
            console.warn(`[plugins] ${manifest.id} onSessionCreated cb threw:`, err?.message);
          }
        });
        entry.disposers.push(dispose);
        return dispose;
      },
      onSessionExited: (cb) => {
        if (!has("session:read")) {
          return () => {};
        }
        const dispose = this.deps.onSessionExitedBus.subscribe((sid) => {
          try {
            cb(sid);
          } catch (err: any) {
            console.warn(`[plugins] ${manifest.id} onSessionExited cb threw:`, err?.message);
          }
        });
        entry.disposers.push(dispose);
        return dispose;
      },
    };
  }

  list(): PluginInfo[] {
    return [...this.loaded.values()].map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      version: e.manifest.version,
      enabled: e.error === null,
      hasUi: !!e.manifest.ui,
      permissions: e.manifest.permissions ?? [],
      error: e.error ?? undefined,
    }));
  }

  get(id: string): LoadedPlugin | null {
    return this.loaded.get(id) ?? null;
  }

  /** Returns the absolute file path for a given plugin's UI asset, or null
   *  if the plugin has no UI or the path escapes the plugin dir. */
  resolveUiAsset(pluginId: string, relPath: string): string | null {
    const entry = this.loaded.get(pluginId);
    if (!entry || !entry.manifest.ui) return null;
    const uiRoot = resolve(entry.dir, entry.manifest.ui);
    const target = resolve(uiRoot, relPath === "" ? "index.html" : relPath);
    const rel = relative(uiRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) return null;
    return target;
  }

  async call(
    pluginId: string,
    method: string,
    payload: unknown,
  ): Promise<{ ok: true; data?: unknown } | { ok: false; error: string }> {
    const entry = this.loaded.get(pluginId);
    if (!entry) return { ok: false, error: `no plugin: ${pluginId}` };
    if (entry.error) return { ok: false, error: `plugin disabled: ${entry.error}` };
    const handler = entry.plugin.handleCall;
    if (!handler) return { ok: false, error: "plugin does not accept calls" };
    const callCtx: PluginCallContext = {
      id: entry.manifest.id,
      log: (m) => console.log(`[plugin:${entry.manifest.id}] ${m}`),
      hasPermission: (p) => (entry.manifest.permissions ?? []).includes(p),
    };
    try {
      const data = await handler(method, payload, callCtx);
      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  async unloadAll(): Promise<void> {
    for (const entry of this.loaded.values()) {
      for (const d of entry.disposers.splice(0)) {
        try {
          d();
        } catch {}
      }
      if (entry.plugin.onUnload) {
        try {
          await entry.plugin.onUnload();
        } catch (err: any) {
          console.warn(`[plugins] ${entry.manifest.id} onUnload threw:`, err?.message);
        }
      }
    }
    this.loaded.clear();
  }
}

function sessionMetaLite(m: SessionMeta): SessionMetaLite {
  const out: SessionMetaLite = {
    id: m.id,
    cwd: m.cwd,
    status: m.status,
  };
  if (m.title !== undefined) out.title = m.title;
  if (m.projectId !== undefined) out.projectId = m.projectId;
  return out;
}
