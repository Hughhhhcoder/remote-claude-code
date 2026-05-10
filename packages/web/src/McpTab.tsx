import { createSignal, createEffect, For, Show, onCleanup, createMemo } from "solid-js";
import type {
  McpServerSummary,
  McpServerDetail,
  McpScope,
  McpTransport,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: "stdio",
  http: "http",
  sse: "sse",
};

const SCOPE_LABEL: Record<McpScope, string> = {
  local: "本地",
  user: "用户",
  project: "项目",
};

function initial(name: string): string {
  return (name[0] ?? "?").toUpperCase();
}

function colorForName(name: string): { bg: string; text: string } {
  const palettes = [
    { bg: "bg-sky-500/15", text: "text-sky-400" },
    { bg: "bg-violet-500/15", text: "text-violet-400" },
    { bg: "bg-emerald-500/15", text: "text-emerald-400" },
    { bg: "bg-amber-500/15", text: "text-amber-400" },
    { bg: "bg-rose-500/15", text: "text-rose-400" },
    { bg: "bg-fuchsia-500/15", text: "text-fuchsia-400" },
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length]!;
}

function statusDot(s: McpServerSummary["status"]): { dot: string; label: string; text: string } {
  switch (s) {
    case "ready":
      return { dot: "bg-emerald-400", label: "ready", text: "text-emerald-400" };
    case "failed":
      return { dot: "bg-rose-400", label: "failed", text: "text-rose-400" };
    case "disabled":
      return { dot: "bg-zinc-600", label: "disabled", text: "text-zinc-500" };
    default:
      return { dot: "bg-amber-400", label: "unknown", text: "text-amber-400" };
  }
}

export function McpTab(props: Props) {
  const [servers, setServers] = createSignal<McpServerSummary[]>([]);
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [detail, setDetail] = createSignal<McpServerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = createSignal(false);
  const [addOpen, setAddOpen] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "mcp.list") {
      setServers(frame.servers);
    } else if (frame.t === "mcp.get") {
      setDetail(frame.server);
      setLoadingDetail(false);
    } else if (frame.t === "mcp.removed") {
      if (expanded() === frame.name) {
        setExpanded(null);
        setDetail(null);
      }
    } else if (frame.t === "error" && frame.code?.startsWith("mcp_")) {
      setError(frame.message);
      setLoadingDetail(false);
    }
  });
  onCleanup(unsub);

  // Initial load
  props.client.send({ v: 1, t: "mcp.list.request" });

  createEffect(() => {
    const name = expanded();
    if (!name) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setDetail(null);
    props.client.send({ v: 1, t: "mcp.get.request", name });
  });

  function refresh() {
    props.client.send({ v: 1, t: "mcp.list.request" });
  }

  function toggle(server: McpServerSummary) {
    props.client.send({ v: 1, t: "mcp.toggle", name: server.name, enabled: !(!server.disabled) });
  }

  function remove(server: McpServerSummary) {
    if (!confirm(`确认移除 MCP server "${server.name}"？`)) return;
    props.client.send({ v: 1, t: "mcp.remove", name: server.name, scope: server.scope });
  }

  const activeCount = createMemo(() => servers().filter((s) => !s.disabled && s.status === "ready").length);

  return (
    <div>
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h1 class="text-2xl font-semibold">MCP Servers</h1>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              {activeCount()} 活跃 / {servers().length} 总数
            </span>
          </div>
          <p class="text-sm text-zinc-400 max-w-2xl">
            Model Context Protocol 让 Claude 访问你的数据源、API、内部服务。改动同步到 <code class="mono text-xs px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300">claude mcp</code> 并广播到所有已配对设备。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={refresh}
            class="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 text-xs"
          >
            ⟳ 刷新
          </button>
          <button
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
            class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 text-white text-xs font-medium"
          >
            + 添加 Server
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 px-4 py-2 text-xs flex items-center justify-between">
          <span class="font-mono truncate">{error()}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            class="text-rose-200 hover:text-white ml-3"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      </Show>

      <Show
        when={servers().length > 0}
        fallback={
          <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center">
            <div class="text-sm text-zinc-400">还没有配置任何 MCP server</div>
            <div class="text-xs text-zinc-600 mt-1">点击右上角 "+ 添加 Server" 新建一个</div>
          </div>
        }
      >
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden mb-8">
          <div class="grid grid-cols-[2fr_2fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-zinc-800 text-[10px] uppercase tracking-widest text-zinc-500">
            <div>Server</div>
            <div>Transport</div>
            <div>状态</div>
            <div>操作</div>
          </div>

          <For each={servers()}>
            {(s) => {
              const c = colorForName(s.name);
              const st = statusDot(s.status);
              const isExpanded = () => expanded() === s.name;
              return (
                <>
                  <div
                    class="grid grid-cols-[2fr_2fr_1fr_auto] gap-4 px-4 py-3 border-b border-zinc-800 items-center hover:bg-zinc-900/60 cursor-pointer"
                    onClick={() => setExpanded(isExpanded() ? null : s.name)}
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <div class={`w-8 h-8 rounded-lg ${c.bg} ${c.text} grid place-items-center text-sm font-semibold shrink-0`}>
                        {initial(s.name)}
                      </div>
                      <div class="min-w-0">
                        <div class="text-sm font-medium truncate flex items-center gap-2">
                          {s.name}
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-normal">
                            {SCOPE_LABEL[s.scope]}
                          </span>
                        </div>
                        <div class="text-[11px] text-zinc-500 truncate font-mono">{s.commandOrUrl}</div>
                      </div>
                    </div>
                    <div class="text-[11px] font-mono text-zinc-400 truncate flex items-center gap-2">
                      <span class="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {TRANSPORT_LABEL[s.transport]}
                      </span>
                      <Show when={s.statusMessage}>
                        <span class="text-zinc-500 truncate">{s.statusMessage}</span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-1.5 text-xs">
                      <span class={`w-1.5 h-1.5 rounded-full ${st.dot}`}></span>
                      <span class={st.text}>{st.label}</span>
                    </div>
                    <div
                      class="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        class="text-[11px] px-2 py-1 rounded text-zinc-400 hover:bg-zinc-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(isExpanded() ? null : s.name);
                        }}
                      >
                        {isExpanded() ? "收起" : "详情"}
                      </button>
                      <button
                        class="text-[11px] px-2 py-1 rounded text-rose-400 hover:bg-rose-500/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(s);
                        }}
                        title="移除"
                      >
                        🗑
                      </button>
                      <ToggleSwitch
                        on={!s.disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(s);
                        }}
                      />
                    </div>
                  </div>
                  <Show when={isExpanded()}>
                    <div class="border-b border-zinc-800 bg-zinc-950/70">
                      <DetailPanel
                        name={s.name}
                        detail={detail()}
                        loading={loadingDetail()}
                      />
                    </div>
                  </Show>
                </>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={addOpen()}>
        <AddServerModal
          onCancel={() => setAddOpen(false)}
          onSubmit={(input) => {
            setAddOpen(false);
            setError(null);
            props.client.send({ v: 1, t: "mcp.add", ...input });
          }}
        />
      </Show>
    </div>
  );
}

function ToggleSwitch(props: { on: boolean; onClick: (e: MouseEvent) => void }) {
  return (
    <button
      onClick={props.onClick}
      class={`relative ml-1 inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
        props.on
          ? "bg-sky-500/80 border-sky-400"
          : "bg-zinc-800 border-zinc-700"
      }`}
      title={props.on ? "禁用" : "启用"}
    >
      <span
        class={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          props.on ? "translate-x-4" : "translate-x-0.5"
        }`}
      ></span>
    </button>
  );
}

function DetailPanel(props: { name: string; detail: McpServerDetail | null; loading: boolean }) {
  return (
    <Show
      when={!props.loading && props.detail}
      fallback={
        <div class="p-6 text-center text-xs text-zinc-500">
          {props.loading ? "加载中…" : "未能加载详情"}
        </div>
      }
    >
      {(d) => (
        <div class="grid grid-cols-2 gap-6 p-5">
          <div class="space-y-3">
            <InfoRow label="名称" value={d().name} />
            <InfoRow label="Transport" value={d().transport} />
            <InfoRow label="Scope" value={SCOPE_LABEL[d().scope]} />
            <Show when={d().command}>
              <InfoRow label="Command" value={d().command!} mono />
            </Show>
            <Show when={d().args && d().args!.length > 0}>
              <InfoRow label="Args" value={d().args!.join(" ")} mono />
            </Show>
            <Show when={d().url}>
              <InfoRow label="URL" value={d().url!} mono />
            </Show>
            <Show when={d().rawStatus}>
              <InfoRow label="状态" value={d().rawStatus} />
            </Show>
          </div>
          <div>
            <div class="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">
              环境变量 ({d().env.length})
            </div>
            <Show
              when={d().env.length > 0}
              fallback={<div class="text-xs text-zinc-600">无</div>}
            >
              <div class="space-y-1.5">
                <For each={d().env}>
                  {(e) => (
                    <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800">
                      <div class="flex-1 min-w-0">
                        <div class="mono text-[12px] text-zinc-200 truncate">{e.key}</div>
                        <div class="text-[10px] text-zinc-500 truncate font-mono">
                          {e.isSecret ? `••• (${e.length} 字符，已隐藏)` : e.value}
                        </div>
                      </div>
                      <Show when={e.isSecret}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          secret
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

function InfoRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
        {props.label}
      </div>
      <div class={`text-xs text-zinc-200 break-all ${props.mono ? "font-mono" : ""}`}>
        {props.value}
      </div>
    </div>
  );
}

interface AddInput {
  name: string;
  transport: McpTransport;
  scope: McpScope;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
}

function AddServerModal(props: {
  onCancel: () => void;
  onSubmit: (input: AddInput) => void;
}) {
  const [name, setName] = createSignal("");
  const [transport, setTransport] = createSignal<McpTransport>("stdio");
  const [scope, setScope] = createSignal<McpScope>("user");
  const [command, setCommand] = createSignal("");
  const [args, setArgs] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [envRows, setEnvRows] = createSignal<{ k: string; v: string }[]>([{ k: "", v: "" }]);
  const [headerRows, setHeaderRows] = createSignal<{ k: string; v: string }[]>([]);

  function setEnvRow(i: number, field: "k" | "v", v: string) {
    setEnvRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addEnvRow() {
    setEnvRows((prev) => [...prev, { k: "", v: "" }]);
  }
  function removeEnvRow(i: number) {
    setEnvRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setHeaderRow(i: number, field: "k" | "v", v: string) {
    setHeaderRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }
  function addHeaderRow() {
    setHeaderRows((prev) => [...prev, { k: "", v: "" }]);
  }
  function removeHeaderRow(i: number) {
    setHeaderRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    const n = name().trim();
    if (!n) {
      alert("请填写 server 名称");
      return;
    }
    const env: Record<string, string> = {};
    for (const r of envRows()) {
      if (r.k.trim()) env[r.k.trim()] = r.v;
    }
    const headers: Record<string, string> = {};
    for (const r of headerRows()) {
      if (r.k.trim()) headers[r.k.trim()] = r.v;
    }
    const input: AddInput = {
      name: n,
      transport: transport(),
      scope: scope(),
    };
    if (transport() === "stdio") {
      const cmd = command().trim();
      if (!cmd) {
        alert("stdio transport 需要 Command");
        return;
      }
      input.command = cmd;
      const parsed = args().trim() ? args().trim().split(/\s+/) : [];
      if (parsed.length) input.args = parsed;
    } else {
      const u = url().trim();
      if (!u) {
        alert(`${transport()} transport 需要 URL`);
        return;
      }
      input.url = u;
    }
    if (Object.keys(env).length) input.env = env;
    if (Object.keys(headers).length) input.headers = headers;
    props.onSubmit(input);
  }

  return (
    <div
      class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm grid place-items-center"
      onClick={(e) => e.target === e.currentTarget && props.onCancel()}
    >
      <div class="w-[640px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-80px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
        <div class="px-5 py-4 border-b border-zinc-900 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold">添加 MCP Server</div>
            <div class="text-xs text-zinc-500 mt-0.5">等价于 <code class="mono">claude mcp add</code></div>
          </div>
          <button
            class="text-zinc-500 hover:text-zinc-200 text-sm px-2"
            onClick={props.onCancel}
          >
            ✕
          </button>
        </div>

        <div class="p-5 overflow-y-auto flex-1 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">名称</label>
              <input
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="my-server"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
              />
            </div>
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">Scope</label>
              <div class="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
                <For each={["local", "user", "project"] as McpScope[]}>
                  {(s) => (
                    <button
                      onClick={() => setScope(s)}
                      class={`flex-1 px-3 py-1 text-[11px] rounded-md ${
                        scope() === s
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {SCOPE_LABEL[s]}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">Transport</label>
            <div class="flex rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
              <For each={["stdio", "http", "sse"] as McpTransport[]}>
                {(t) => (
                  <button
                    onClick={() => setTransport(t)}
                    class={`flex-1 px-3 py-1.5 text-xs rounded-md ${
                      transport() === t
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {TRANSPORT_LABEL[t]}
                  </button>
                )}
              </For>
            </div>
          </div>

          <Show when={transport() === "stdio"}>
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">Command</label>
              <input
                value={command()}
                onInput={(e) => setCommand(e.currentTarget.value)}
                placeholder="npx"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-700"
              />
            </div>
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">Args（空格分隔）</label>
              <input
                value={args()}
                onInput={(e) => setArgs(e.currentTarget.value)}
                placeholder="-y tavily-mcp@latest"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-700"
              />
            </div>
          </Show>

          <Show when={transport() !== "stdio"}>
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">URL</label>
              <input
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                placeholder="https://mcp.example.com/sse"
                class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-zinc-700"
              />
            </div>
            <div>
              <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">Headers（可选）</label>
              <div class="space-y-1.5">
                <For each={headerRows()}>
                  {(r, i) => (
                    <div class="flex items-center gap-1">
                      <input
                        value={r.k}
                        onInput={(e) => setHeaderRow(i(), "k", e.currentTarget.value)}
                        placeholder="Authorization"
                        class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none"
                      />
                      <input
                        value={r.v}
                        onInput={(e) => setHeaderRow(i(), "v", e.currentTarget.value)}
                        placeholder="Bearer xxx"
                        class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none"
                      />
                      <button
                        onClick={() => removeHeaderRow(i())}
                        class="px-2 py-1 text-zinc-500 hover:text-rose-400"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </For>
                <button onClick={addHeaderRow} class="text-[11px] text-sky-400 hover:underline">
                  + 添加 header
                </button>
              </div>
            </div>
          </Show>

          <div>
            <label class="block text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">环境变量</label>
            <div class="space-y-1.5">
              <For each={envRows()}>
                {(r, i) => (
                  <div class="flex items-center gap-1">
                    <input
                      value={r.k}
                      onInput={(e) => setEnvRow(i(), "k", e.currentTarget.value)}
                      placeholder="API_KEY"
                      class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none"
                    />
                    <input
                      type={/KEY|TOKEN|SECRET|PASSWORD/i.test(r.k) ? "password" : "text"}
                      value={r.v}
                      onInput={(e) => setEnvRow(i(), "v", e.currentTarget.value)}
                      placeholder="value"
                      class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 outline-none"
                    />
                    <button
                      onClick={() => removeEnvRow(i())}
                      class="px-2 py-1 text-zinc-500 hover:text-rose-400"
                    >
                      🗑
                    </button>
                  </div>
                )}
              </For>
              <button onClick={addEnvRow} class="text-[11px] text-sky-400 hover:underline">
                + 添加变量
              </button>
            </div>
          </div>
        </div>

        <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
          <button
            onClick={props.onCancel}
            class="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
          >
            取消
          </button>
          <button
            onClick={submit}
            class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 text-white text-xs font-medium"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
