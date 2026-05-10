import type { IncomingMessage, ServerResponse } from "node:http";
import type { PermissionMode, SessionMeta, Frame, ProjectColor } from "@rcc/protocol";
import { PermissionMode as PermissionModeSchema, PROJECT_COLORS } from "@rcc/protocol";
import type { SessionRegistry, AnySession } from "./session.ts";
import type { ProjectStore } from "./projects.ts";
import type { TrustStore, PairedDevice } from "./trust.ts";
import type { ShareStore } from "./shares.ts";
import type { StarterStore } from "./starters.ts";
import {
  listSkills,
  toggleSkill,
  writeSkill,
  deleteSkill,
  readSkillContent,
} from "./skills.ts";
import { listMcp, getMcp, addMcp, removeMcp, setMcpEnabled } from "./mcp.ts";
import {
  listCommands,
  readCommand,
  saveCommand,
  deleteCommand,
} from "./commands.ts";
import {
  listSubagents,
  readSubagent,
  saveSubagent,
  deleteSubagent,
} from "./subagents.ts";
import { listHooks, writeHook, deleteHook, HOOK_EVENT_NAMES, type HookEventName, type HookAction } from "./hooks.ts";
import {
  listPermissions,
  addRule as permAddRule,
  removeRule as permRemoveRule,
} from "./permissions.ts";
import { openApiSpec } from "./openapi.ts";

const JSON_CT = "application/json;charset=utf-8";
const MAX_BODY = 1_000_000;

export interface AuthResult {
  ok: boolean;
  device: PairedDevice | null;
  reason?: string;
}

export interface RestCtx {
  registry: SessionRegistry;
  projects: ProjectStore;
  trust: TrustStore;
  shares: ShareStore;
  starters: StarterStore;
  defaultCwd: string;
  defaultPermissionMode: PermissionMode;
  claudeCommand: string;
  claudeArgs: string[];
  authenticate: (req: IncomingMessage) => AuthResult;
  /** Called after REST creates a session; host wires approval/chat/metrics/git/persistence. */
  onSessionCreated: (s: AnySession) => void;
  /** Swap an archived (DeadSession) back to a live one; returns the live session or null. */
  resumeArchivedSession: (sid: string) => AnySession | null;
  /** Broadcast a frame to all ws clients (session.list after mutations). */
  broadcast: (frame: Frame) => void;
  sessionMetaWithSummary: (s: AnySession) => SessionMeta;
  mergedSessionList: () => SessionMeta[];
  /** Returns {listing of archived "dead" sessions} etc — same as registry.get but safe. */
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": JSON_CT,
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function writeError(res: ServerResponse, status: number, code: string, error: string): void {
  writeJson(res, status, { error, code });
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as T) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function getPath(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

function asProjectColor(v: unknown): ProjectColor | null {
  if (typeof v !== "string") return null;
  return (PROJECT_COLORS as readonly string[]).includes(v) ? (v as ProjectColor) : null;
}

function asHookEvent(v: unknown): HookEventName | null {
  if (typeof v !== "string") return null;
  return (HOOK_EVENT_NAMES as readonly string[]).includes(v) ? (v as HookEventName) : null;
}

function sessionMetaLite(s: AnySession): SessionMeta {
  return s.meta();
}

export async function handleRestRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
): Promise<void> {
  const url = req.url ?? "";
  const path = getPath(url);
  const method = req.method ?? "GET";

  if (path === "/api/v1/health") {
    writeJson(res, 200, {
      ok: true,
      sessions: ctx.registry.list().length,
      devices: ctx.trust.devices().length,
    });
    return;
  }

  const auth = ctx.authenticate(req);
  if (!auth.ok) {
    res.writeHead(401, {
      "content-type": JSON_CT,
      "x-rcc-auth-reason": auth.reason ?? "auth_required",
    });
    res.end(
      JSON.stringify({ error: auth.reason ?? "auth_required", code: "unauthorized" }),
    );
    return;
  }

  try {
    if (await routeSessions(req, res, ctx, path, method)) return;
    if (await routeProjects(req, res, ctx, path, method)) return;
    if (await routeSkills(req, res, ctx, path, method)) return;
    if (await routeMcp(req, res, path, method)) return;
    if (await routeCommands(req, res, ctx, path, method)) return;
    if (await routeSubagents(req, res, ctx, path, method)) return;
    if (await routeHooks(req, res, ctx, path, method)) return;
    if (await routePermissions(req, res, ctx, path, method)) return;
    if (await routeStarters(req, res, ctx, path, method)) return;
    writeError(res, 404, "not_found", `no route: ${method} ${path}`);
  } catch (err: any) {
    if (res.headersSent) return;
    const msg = err?.message ?? "internal_error";
    if (msg === "payload_too_large") {
      writeError(res, 413, "payload_too_large", msg);
      return;
    }
    writeError(res, 500, "internal_error", msg);
  }
}

async function routeSessions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/sessions" && method === "GET") {
    writeJson(res, 200, { sessions: ctx.mergedSessionList() });
    return true;
  }
  if (path === "/api/v1/sessions" && method === "POST") {
    const body = await readJsonBody<{
      cwd?: string;
      permissionMode?: string;
      projectId?: string;
      starterId?: string;
      driver?: "cli" | "sdk";
      cols?: number;
      rows?: number;
    }>(req);
    let project = body.projectId ? ctx.projects.getById(body.projectId) : undefined;
    if (!project && body.cwd) project = ctx.projects.findByCwd(body.cwd);
    if (!project) project = ctx.projects.getDefault();
    const cwd = body.cwd ?? project.cwd;
    const driver = body.driver ?? "cli";
    let pm: PermissionMode = ctx.defaultPermissionMode;
    if (body.permissionMode) {
      const parsed = PermissionModeSchema.safeParse(body.permissionMode);
      if (!parsed.success) {
        writeError(res, 400, "invalid_permission_mode", "invalid permissionMode");
        return true;
      }
      pm = parsed.data;
    }
    if (body.starterId) {
      const st = ctx.starters.get(body.starterId);
      if (st?.permissionMode) pm = st.permissionMode;
    }
    try {
      const s = ctx.registry.create({
        driver,
        command: driver === "cli" ? ctx.claudeCommand : undefined,
        args: driver === "cli" ? ctx.claudeArgs : undefined,
        cwd,
        cols: body.cols,
        rows: body.rows,
        permissionMode: pm,
        projectId: project.id,
      });
      ctx.onSessionCreated(s);
      writeJson(res, 201, { session: ctx.sessionMetaWithSummary(s) });
    } catch (err: any) {
      writeError(res, 400, "session_create_failed", err?.message ?? "failed");
    }
    return true;
  }

  const mSid = /^\/api\/v1\/sessions\/([A-Za-z0-9_:-]+)$/.exec(path);
  if (mSid) {
    const sid = mSid[1]!;
    if (method === "GET") {
      const s = ctx.registry.get(sid);
      if (!s) {
        writeError(res, 404, "no_such_session", sid);
        return true;
      }
      writeJson(res, 200, { session: ctx.sessionMetaWithSummary(s) });
      return true;
    }
    if (method === "DELETE") {
      const ok = ctx.registry.close(sid);
      if (ok) {
        ctx.broadcast({ v: 1, t: "session.list", sessions: ctx.mergedSessionList() });
      }
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "no_such_session", code: "not_found" });
      return true;
    }
  }

  const mResume = /^\/api\/v1\/sessions\/([A-Za-z0-9_:-]+)\/resume$/.exec(path);
  if (mResume && method === "POST") {
    const sid = mResume[1]!;
    const s = ctx.registry.get(sid);
    if (!s) {
      writeError(res, 404, "no_such_session", sid);
      return true;
    }
    try {
      const live = ctx.resumeArchivedSession(sid);
      if (!live) {
        // Already live — just return current meta (idempotent-ish).
        writeJson(res, 200, { session: ctx.sessionMetaWithSummary(s) });
        return true;
      }
      writeJson(res, 200, { session: ctx.sessionMetaWithSummary(live) });
    } catch (err: any) {
      writeError(res, 400, "resume_failed", err?.message ?? "failed");
    }
    return true;
  }

  const mChat = /^\/api\/v1\/sessions\/([A-Za-z0-9_:-]+)\/chat$/.exec(path);
  if (mChat && method === "GET") {
    const sid = mChat[1]!;
    const s = ctx.registry.get(sid);
    if (!s) {
      writeError(res, 404, "no_such_session", sid);
      return true;
    }
    writeJson(res, 200, { sid, messages: s.chat.list() });
    return true;
  }

  const mInput = /^\/api\/v1\/sessions\/([A-Za-z0-9_:-]+)\/input$/.exec(path);
  if (mInput && method === "POST") {
    const sid = mInput[1]!;
    const s = ctx.registry.get(sid);
    if (!s) {
      writeError(res, 404, "no_such_session", sid);
      return true;
    }
    const body = await readJsonBody<{ data?: string }>(req);
    if (typeof body.data !== "string") {
      writeError(res, 400, "missing_data", "body.data (string) required");
      return true;
    }
    s.write(body.data);
    writeJson(res, 200, { ok: true, bytes: Buffer.byteLength(body.data, "utf8") });
    return true;
  }

  const mPrompt = /^\/api\/v1\/sessions\/([A-Za-z0-9_:-]+)\/prompt$/.exec(path);
  if (mPrompt && method === "POST") {
    const sid = mPrompt[1]!;
    const s = ctx.registry.get(sid);
    if (!s) {
      writeError(res, 404, "no_such_session", sid);
      return true;
    }
    const body = await readJsonBody<{ prompt?: string }>(req);
    if (typeof body.prompt !== "string" || !body.prompt.length) {
      writeError(res, 400, "missing_prompt", "body.prompt (non-empty string) required");
      return true;
    }
    s.write(body.prompt + "\r");
    writeJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/openapi.json" && method === "GET") {
    writeJson(res, 200, openApiSpec());
    return true;
  }

  return false;
}

async function routeProjects(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/projects" && method === "GET") {
    writeJson(res, 200, { projects: ctx.projects.list() });
    return true;
  }
  if (path === "/api/v1/projects" && method === "POST") {
    const body = await readJsonBody<{ name?: string; cwd?: string; color?: string }>(req);
    if (!body.name || !body.cwd) {
      writeError(res, 400, "missing_fields", "name and cwd required");
      return true;
    }
    try {
      const p = await ctx.projects.create({
        name: body.name,
        cwd: body.cwd,
        color: asProjectColor(body.color) ?? undefined,
      });
      ctx.broadcast({ v: 1, t: "project.list", projects: ctx.projects.list() });
      writeJson(res, 201, { project: p });
    } catch (err: any) {
      writeError(res, 400, "project_create_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mDel = /^\/api\/v1\/projects\/([A-Za-z0-9_-]+)$/.exec(path);
  if (mDel && method === "DELETE") {
    const id = mDel[1]!;
    try {
      const ok = await ctx.projects.remove(id);
      if (ok) ctx.broadcast({ v: 1, t: "project.list", projects: ctx.projects.list() });
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found", code: "not_found" });
    } catch (err: any) {
      writeError(res, 400, "project_remove_failed", err?.message ?? "failed");
    }
    return true;
  }
  return false;
}

async function routeSkills(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/skills" && method === "GET") {
    const skills = await listSkills(ctx.defaultCwd);
    writeJson(res, 200, { skills });
    return true;
  }
  if (path === "/api/v1/skills" && method === "POST") {
    const body = await readJsonBody<{
      name?: string;
      scope?: "user" | "project";
      body?: string;
      description?: string;
    }>(req);
    if (!body.name || !body.scope) {
      writeError(res, 400, "missing_fields", "name and scope required");
      return true;
    }
    try {
      const meta = await writeSkill(
        {
          name: body.name,
          scope: body.scope,
          body: body.body ?? "",
          description: body.description ?? "",
        },
        ctx.defaultCwd,
      );
      writeJson(res, 201, { skill: meta });
    } catch (err: any) {
      writeError(res, 400, "skill_write_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mId = /^\/api\/v1\/skills\/([A-Za-z0-9_:-]+)$/.exec(path);
  if (mId) {
    const id = decodeURIComponent(mId[1]!);
    if (method === "GET") {
      try {
        const content = await readSkillContent(id, ctx.defaultCwd);
        writeJson(res, 200, { skill: content });
      } catch (err: any) {
        writeError(res, 404, "skill_not_found", err?.message ?? "not found");
      }
      return true;
    }
    if (method === "DELETE") {
      const ok = await deleteSkill(id, ctx.defaultCwd);
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found", code: "not_found" });
      return true;
    }
    if (method === "PUT") {
      const body = await readJsonBody<{ enabled?: boolean }>(req);
      if (typeof body.enabled !== "boolean") {
        writeError(res, 400, "missing_fields", "enabled (boolean) required");
        return true;
      }
      try {
        const meta = await toggleSkill(id, body.enabled, ctx.defaultCwd);
        writeJson(res, 200, { skill: meta });
      } catch (err: any) {
        writeError(res, 400, "skill_toggle_failed", err?.message ?? "failed");
      }
      return true;
    }
  }
  return false;
}

async function routeMcp(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/mcp" && method === "GET") {
    const servers = await listMcp();
    writeJson(res, 200, { servers });
    return true;
  }
  if (path === "/api/v1/mcp" && method === "POST") {
    const body = await readJsonBody<{
      name?: string;
      scope?: "local" | "user" | "project";
      transport?: "stdio" | "sse" | "http";
      command?: string;
      args?: string[];
      url?: string;
      env?: Array<{ key: string; value: string }>;
      headers?: Array<{ key: string; value: string }>;
    }>(req);
    if (!body.name || !body.scope || !body.transport) {
      writeError(res, 400, "missing_fields", "name, scope, transport required");
      return true;
    }
    try {
      // reason: REST body declares arrays for env/headers; addMcp expects Record.
      // This endpoint's behavior with arrays is preserved intentionally pending a
      // dedicated REST shape fix.
      await addMcp({
        name: body.name,
        scope: body.scope,
        transport: body.transport,
        command: body.command,
        args: body.args,
        url: body.url,
        env: body.env,
        headers: body.headers,
      } as unknown as Parameters<typeof addMcp>[0]);
      const detail = await getMcp(body.name);
      writeJson(res, 201, { server: detail });
    } catch (err: any) {
      writeError(res, 400, "mcp_add_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mName = /^\/api\/v1\/mcp\/([^/]+)$/.exec(path);
  if (mName) {
    const name = decodeURIComponent(mName[1]!);
    if (method === "GET") {
      const d = await getMcp(name);
      if (!d) {
        writeError(res, 404, "not_found", `mcp ${name}`);
        return true;
      }
      writeJson(res, 200, { server: d });
      return true;
    }
    if (method === "DELETE") {
      try {
        await removeMcp(name);
        writeJson(res, 200, { ok: true });
      } catch (err: any) {
        writeError(res, 400, "mcp_remove_failed", err?.message ?? "failed");
      }
      return true;
    }
    if (method === "PUT") {
      const body = await readJsonBody<{ enabled?: boolean }>(req);
      if (typeof body.enabled !== "boolean") {
        writeError(res, 400, "missing_fields", "enabled (boolean) required");
        return true;
      }
      try {
        await setMcpEnabled(name, body.enabled, null);
        const d = await getMcp(name);
        writeJson(res, 200, { server: d });
      } catch (err: any) {
        writeError(res, 400, "mcp_toggle_failed", err?.message ?? "failed");
      }
      return true;
    }
  }
  return false;
}

async function routeCommands(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/commands" && method === "GET") {
    const commands = await listCommands(ctx.defaultCwd);
    writeJson(res, 200, { commands });
    return true;
  }
  if (path === "/api/v1/commands" && method === "POST") {
    const body = await readJsonBody<{
      name?: string;
      scope?: "user" | "project";
      body?: string;
      description?: string;
    }>(req);
    if (!body.name || !body.scope) {
      writeError(res, 400, "missing_fields", "name and scope required");
      return true;
    }
    try {
      const meta = await saveCommand(
        {
          name: body.name,
          scope: body.scope,
          body: body.body ?? "",
          description: body.description,
        },
        ctx.defaultCwd,
      );
      writeJson(res, 201, { command: meta });
    } catch (err: any) {
      writeError(res, 400, "command_save_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mId = /^\/api\/v1\/commands\/([A-Za-z0-9_:-]+)$/.exec(path);
  if (mId) {
    const id = decodeURIComponent(mId[1]!);
    if (method === "GET") {
      try {
        const c = await readCommand(id, ctx.defaultCwd);
        writeJson(res, 200, { command: c });
      } catch (err: any) {
        writeError(res, 404, "command_not_found", err?.message ?? "not found");
      }
      return true;
    }
    if (method === "DELETE") {
      const ok = await deleteCommand(id, ctx.defaultCwd);
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found", code: "not_found" });
      return true;
    }
  }
  return false;
}

async function routeSubagents(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/subagents" && method === "GET") {
    const subagents = await listSubagents(ctx.defaultCwd);
    writeJson(res, 200, { subagents });
    return true;
  }
  if (path === "/api/v1/subagents" && method === "POST") {
    const body = await readJsonBody<{
      name?: string;
      scope?: "user" | "project";
      body?: string;
      description?: string;
      model?: string;
      tools?: string;
    }>(req);
    if (!body.name || !body.scope) {
      writeError(res, 400, "missing_fields", "name and scope required");
      return true;
    }
    try {
      const meta = await saveSubagent(
        {
          name: body.name,
          scope: body.scope,
          body: body.body ?? "",
          description: body.description,
          model: body.model,
          tools: body.tools,
        },
        ctx.defaultCwd,
      );
      writeJson(res, 201, { subagent: meta });
    } catch (err: any) {
      writeError(res, 400, "subagent_save_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mId = /^\/api\/v1\/subagents\/([A-Za-z0-9_:-]+)$/.exec(path);
  if (mId) {
    const id = decodeURIComponent(mId[1]!);
    if (method === "GET") {
      try {
        const c = await readSubagent(id, ctx.defaultCwd);
        writeJson(res, 200, { subagent: c });
      } catch (err: any) {
        writeError(res, 404, "subagent_not_found", err?.message ?? "not found");
      }
      return true;
    }
    if (method === "DELETE") {
      const ok = await deleteSubagent(id, ctx.defaultCwd);
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found", code: "not_found" });
      return true;
    }
  }
  return false;
}

async function routeHooks(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/hooks" && method === "GET") {
    const hooks = await listHooks("all", ctx.defaultCwd);
    writeJson(res, 200, { hooks });
    return true;
  }
  if (path === "/api/v1/hooks" && method === "POST") {
    const body = await readJsonBody<{
      scope?: "user" | "project";
      event?: string;
      index?: number;
      matcher?: string;
      hooks?: unknown[];
    }>(req);
    if (!body.scope || !body.event || !Array.isArray(body.hooks)) {
      writeError(res, 400, "missing_fields", "scope, event, hooks[] required");
      return true;
    }
    try {
      const ev = asHookEvent(body.event);
      if (!ev) {
        writeError(res, 400, "invalid_event", `unknown hook event: ${body.event}`);
        return true;
      }
      await writeHook(
        body.scope,
        ev,
        typeof body.index === "number" ? body.index : -1,
        body.matcher,
        body.hooks as HookAction[],
        ctx.defaultCwd,
      );
      const hooks = await listHooks("all", ctx.defaultCwd);
      writeJson(res, 201, { hooks });
    } catch (err: any) {
      writeError(res, 400, "hook_write_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mDel = /^\/api\/v1\/hooks\/([^/]+)\/([^/]+)\/(\d+)$/.exec(path);
  if (mDel && method === "DELETE") {
    const scope = decodeURIComponent(mDel[1]!);
    const event = decodeURIComponent(mDel[2]!);
    const index = Number(mDel[3]!);
    if (scope !== "user" && scope !== "project") {
      writeError(res, 400, "invalid_scope", "scope must be user|project");
      return true;
    }
    try {
      const ev = asHookEvent(event);
      if (!ev) {
        writeError(res, 400, "invalid_event", `unknown hook event: ${event}`);
        return true;
      }
      const ok = await deleteHook(scope, ev, index, ctx.defaultCwd);
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found", code: "not_found" });
    } catch (err: any) {
      writeError(res, 400, "hook_delete_failed", err?.message ?? "failed");
    }
    return true;
  }
  return false;
}

async function routePermissions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/permissions" && method === "GET") {
    const permissions = await listPermissions(ctx.defaultCwd);
    writeJson(res, 200, { permissions });
    return true;
  }
  if (path === "/api/v1/permissions" && method === "POST") {
    const body = await readJsonBody<{
      scope?: "user" | "project" | "local";
      bucket?: "allow" | "deny" | "ask";
      rule?: string;
    }>(req);
    if (!body.scope || !body.bucket || !body.rule) {
      writeError(res, 400, "missing_fields", "scope, bucket, rule required");
      return true;
    }
    try {
      await permAddRule(body.scope, body.bucket, body.rule, ctx.defaultCwd);
      const permissions = await listPermissions(ctx.defaultCwd);
      writeJson(res, 201, { permissions });
    } catch (err: any) {
      writeError(res, 400, "perm_add_failed", err?.message ?? "failed");
    }
    return true;
  }
  if (path === "/api/v1/permissions" && method === "DELETE") {
    const body = await readJsonBody<{
      scope?: "user" | "project" | "local";
      bucket?: "allow" | "deny" | "ask";
      rule?: string;
    }>(req);
    if (!body.scope || !body.bucket || !body.rule) {
      writeError(res, 400, "missing_fields", "scope, bucket, rule required");
      return true;
    }
    try {
      await permRemoveRule(body.scope, body.bucket, body.rule, ctx.defaultCwd);
      const permissions = await listPermissions(ctx.defaultCwd);
      writeJson(res, 200, { permissions });
    } catch (err: any) {
      writeError(res, 400, "perm_remove_failed", err?.message ?? "failed");
    }
    return true;
  }
  return false;
}

async function routeStarters(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RestCtx,
  path: string,
  method: string,
): Promise<boolean> {
  if (path === "/api/v1/starters" && method === "GET") {
    writeJson(res, 200, { starters: ctx.starters.list() });
    return true;
  }
  if (path === "/api/v1/starters" && method === "POST") {
    const body = await readJsonBody<{
      id?: string;
      name?: string;
      description?: string;
      systemPrompt?: string;
      enableSkills?: string[];
      firstSteps?: any[];
      permissionMode?: string;
      icon?: string;
      color?: string;
    }>(req);
    if (!body.name) {
      writeError(res, 400, "missing_fields", "name required");
      return true;
    }
    try {
      // reason: REST body declares loose shapes (any[] / string); starters.save
      // and PermissionMode enforce the real constraints at call time.
      const s = await ctx.starters.save({
        id: body.id,
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        enableSkills: body.enableSkills,
        firstSteps: body.firstSteps as Parameters<typeof ctx.starters.save>[0]["firstSteps"],
        permissionMode: body.permissionMode as Parameters<typeof ctx.starters.save>[0]["permissionMode"],
        icon: body.icon,
        color: body.color,
      });
      writeJson(res, 201, { starter: s });
    } catch (err: any) {
      writeError(res, 400, "starter_save_failed", err?.message ?? "failed");
    }
    return true;
  }
  const mId = /^\/api\/v1\/starters\/([A-Za-z0-9_:-]+)$/.exec(path);
  if (mId && method === "DELETE") {
    const id = decodeURIComponent(mId[1]!);
    try {
      const ok = await ctx.starters.remove(id);
      writeJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found", code: "not_found" });
    } catch (err: any) {
      writeError(res, 400, "starter_remove_failed", err?.message ?? "failed");
    }
    return true;
  }
  return false;
}
