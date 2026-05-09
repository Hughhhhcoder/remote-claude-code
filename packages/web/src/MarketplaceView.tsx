import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type {
  MarketMcpEntry,
  MarketPluginEntry,
  MarketScope,
  MarketSkillEntry,
  MarketSource,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface CatalogState {
  skills: MarketSkillEntry[];
  mcps: MarketMcpEntry[];
  plugins: MarketPluginEntry[];
  sources: MarketSource[];
  fetchedAt: number;
}

interface Props {
  open: boolean;
  client: RccClient;
  onClose: () => void;
}

type Tab = "skills" | "mcps" | "plugins";

type InstallState = Record<
  string,
  { status: "idle" | "installing" | "ok" | "error"; message?: string }
>;

interface SkillInstallPrompt {
  entry: MarketSkillEntry;
  scope: MarketScope;
}

interface McpInstallPrompt {
  entry: MarketMcpEntry;
  scope: MarketScope;
  env: Record<string, string>;
}

interface PluginInstallPrompt {
  entry: MarketPluginEntry;
}

const ICONS = ["✨", "🔒", "🔍", "📝", "🎨", "📚", "⚙", "🧪", "🚀", "🧠", "📦"];
function iconFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ICONS[h % ICONS.length]!;
}

export function MarketplaceView(props: Props) {
  const [tab, setTab] = createSignal<Tab>("skills");
  const [query, setQuery] = createSignal("");
  const [catalog, setCatalog] = createSignal<CatalogState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [state, setState] = createSignal<InstallState>({});
  const [skillPrompt, setSkillPrompt] = createSignal<SkillInstallPrompt | null>(null);
  const [mcpPrompt, setMcpPrompt] = createSignal<McpInstallPrompt | null>(null);
  const [pluginPrompt, setPluginPrompt] = createSignal<PluginInstallPrompt | null>(null);

  const unsub = props.client.on((frame) => {
    if (frame.t === "market.catalog") {
      setCatalog({
        skills: frame.skills,
        mcps: frame.mcps,
        plugins: frame.plugins ?? [],
        sources: frame.sources,
        fetchedAt: frame.fetchedAt,
      });
      setLoading(false);
    }
    if (frame.t === "market.skill.installed") {
      setState((s) => ({
        ...s,
        [`skill:${frame.id}`]: {
          status: frame.ok ? "ok" : "error",
          message: frame.ok ? `已安装为 ${frame.installedName}` : frame.error,
        },
      }));
    }
    if (frame.t === "market.mcp.installed") {
      setState((s) => ({
        ...s,
        [`mcp:${frame.id}`]: {
          status: frame.ok ? "ok" : "error",
          message: frame.ok ? `已添加为 ${frame.installedName}` : frame.error,
        },
      }));
    }
    if (frame.t === "market.plugin.installed") {
      setState((s) => ({
        ...s,
        [`plugin:${frame.id}`]: {
          status: frame.ok ? "ok" : "error",
          message: frame.ok
            ? `已写入 ~/.rcc/plugins/${frame.pluginId}/ — 重启 host 后生效`
            : frame.error,
        },
      }));
    }
  });
  onCleanup(unsub);

  function refresh(force = false) {
    setLoading(true);
    props.client.send({ v: 1, t: "market.catalog.request", force });
  }

  onMount(() => {
    if (props.open) refresh(false);
  });

  // Refresh the catalog the first time the modal is opened.
  let bootedOnce = false;
  const visibility = createMemo(() => props.open);
  const _ = createMemo(() => {
    if (visibility() && !bootedOnce) {
      bootedOnce = true;
      refresh(false);
    }
    return null;
  });
  void _();

  const filteredSkills = createMemo(() => {
    const c = catalog();
    if (!c) return [];
    const q = query().trim().toLowerCase();
    if (!q) return c.skills;
    return c.skills.filter((s) => {
      const blob = `${s.name} ${s.description} ${(s.tags ?? []).join(" ")} ${s.author ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  });

  const filteredMcps = createMemo(() => {
    const c = catalog();
    if (!c) return [];
    const q = query().trim().toLowerCase();
    if (!q) return c.mcps;
    return c.mcps.filter((m) => {
      const blob = `${m.name} ${m.description} ${(m.tags ?? []).join(" ")} ${m.author ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  });

  const filteredPlugins = createMemo(() => {
    const c = catalog();
    if (!c) return [];
    const q = query().trim().toLowerCase();
    if (!q) return c.plugins;
    return c.plugins.filter((p) => {
      const blob = `${p.name} ${p.description} ${(p.tags ?? []).join(" ")} ${p.author ?? ""} ${(p.permissions ?? []).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  });

  function openSkillPrompt(entry: MarketSkillEntry) {
    setSkillPrompt({ entry, scope: "user" });
  }

  function confirmSkillInstall() {
    const p = skillPrompt();
    if (!p) return;
    setState((s) => ({ ...s, [`skill:${p.entry.id}`]: { status: "installing" } }));
    props.client.send({
      v: 1,
      t: "market.install.skill",
      id: p.entry.id,
      scope: p.scope,
    });
    setSkillPrompt(null);
  }

  function openMcpPrompt(entry: MarketMcpEntry) {
    const env: Record<string, string> = {};
    for (const k of entry.envHints ?? []) env[k] = "";
    setMcpPrompt({ entry, scope: "user", env });
  }

  function confirmMcpInstall() {
    const p = mcpPrompt();
    if (!p) return;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.env)) {
      if (v.trim().length) env[k] = v;
    }
    setState((s) => ({ ...s, [`mcp:${p.entry.id}`]: { status: "installing" } }));
    props.client.send({
      v: 1,
      t: "market.install.mcp",
      id: p.entry.id,
      scope: p.scope,
      env,
    });
    setMcpPrompt(null);
  }

  function openPluginPrompt(entry: MarketPluginEntry) {
    setPluginPrompt({ entry });
  }

  function confirmPluginInstall() {
    const p = pluginPrompt();
    if (!p) return;
    setState((s) => ({ ...s, [`plugin:${p.entry.id}`]: { status: "installing" } }));
    props.client.send({
      v: 1,
      t: "market.install.plugin",
      id: p.entry.id,
    });
    setPluginPrompt(null);
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-4"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="w-[1080px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden">
          {/* header */}
          <div class="px-6 py-4 border-b border-zinc-900 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 grid place-items-center text-white text-lg shrink-0">
                📥
              </div>
              <div class="min-w-0">
                <div class="text-base font-semibold">Marketplace</div>
                <div class="text-[11px] text-zinc-500 truncate">
                  社区共享 Skills + MCP servers · 一键安装
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
                <span class="text-zinc-600">⌕</span>
                <input
                  placeholder="搜索 name/tag…"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  class="bg-transparent outline-none w-40 text-zinc-300 placeholder-zinc-600"
                />
              </div>
              <button
                onClick={() => refresh(true)}
                disabled={loading()}
                class="px-2.5 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                title="强制刷新（绕过 1h 缓存）"
              >
                ⟳
              </button>
              <button
                onClick={props.onClose}
                class="text-zinc-500 hover:text-zinc-200 text-sm px-2"
              >
                ✕
              </button>
            </div>
          </div>

          {/* tabs */}
          <div class="px-6 pt-3 border-b border-zinc-900 flex items-center gap-2">
            <TabBtn
              active={tab() === "skills"}
              onClick={() => setTab("skills")}
              label="Skills"
              count={catalog()?.skills.length ?? 0}
            />
            <TabBtn
              active={tab() === "mcps"}
              onClick={() => setTab("mcps")}
              label="MCP Servers"
              count={catalog()?.mcps.length ?? 0}
            />
            <TabBtn
              active={tab() === "plugins"}
              onClick={() => setTab("plugins")}
              label="Plugins"
              count={catalog()?.plugins.length ?? 0}
            />
            <Show when={catalog()}>
              <span class="ml-auto text-[11px] text-zinc-600">
                来源: {catalog()!.sources.length} · 已缓存 1h
              </span>
            </Show>
          </div>

          {/* body */}
          <div class="flex-1 overflow-y-auto scrollbar p-6">
            <Show when={catalog()} fallback={
              <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
                {loading() ? "载入 catalog 中…" : "未加载"}
              </div>
            }>
              <Show when={tab() === "skills"}>
                <Show
                  when={filteredSkills().length > 0}
                  fallback={<EmptyCard label="没有匹配的 skill" />}
                >
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <For each={filteredSkills()}>
                      {(s) => (
                        <SkillCard
                          entry={s}
                          state={state()[`skill:${s.id}`]}
                          onInstall={() => openSkillPrompt(s)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
              <Show when={tab() === "mcps"}>
                <Show
                  when={filteredMcps().length > 0}
                  fallback={<EmptyCard label="没有匹配的 MCP server" />}
                >
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <For each={filteredMcps()}>
                      {(m) => (
                        <McpCard
                          entry={m}
                          state={state()[`mcp:${m.id}`]}
                          onInstall={() => openMcpPrompt(m)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
              <Show when={tab() === "plugins"}>
                <Show
                  when={filteredPlugins().length > 0}
                  fallback={<EmptyCard label="没有匹配的 plugin" />}
                >
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <For each={filteredPlugins()}>
                      {(p) => (
                        <PluginCard
                          entry={p}
                          state={state()[`plugin:${p.id}`]}
                          onInstall={() => openPluginPrompt(p)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
              <Show when={catalog() && catalog()!.sources.some((s) => !s.ok)}>
                <div class="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-200">
                  <div class="font-medium mb-1">部分 manifest 加载失败:</div>
                  <ul class="space-y-0.5 font-mono text-amber-100/80">
                    <For each={catalog()!.sources.filter((s) => !s.ok)}>
                      {(src) => <li>· {src.url} — {src.error ?? "?"}</li>}
                    </For>
                  </ul>
                </div>
              </Show>
            </Show>
          </div>

          {/* footer */}
          <div class="px-6 py-3 border-t border-zinc-900 text-[11px] text-zinc-500 flex items-center justify-between gap-4">
            <span>
              添加更多 manifest URL: 编辑 <span class="font-mono text-zinc-400">~/.rcc/config.json</span> → <span class="font-mono text-zinc-400">marketplace.manifestUrls</span>
            </span>
            <span>
              安装仅允许 <span class="font-mono">npx/uvx/node/python</span> 启动；不会下载二进制
            </span>
          </div>
        </div>

        <Show when={skillPrompt()}>{renderSkillPrompt()}</Show>
        <Show when={mcpPrompt()}>{renderMcpPrompt()}</Show>
        <Show when={pluginPrompt()}>{renderPluginPrompt()}</Show>
      </div>
    </Show>
  );

  function renderSkillPrompt() {
    const p = skillPrompt()!;
    return (
      <div
        class="fixed inset-0 z-[70] bg-black/60 grid place-items-center p-4"
        onClick={(e) => e.target === e.currentTarget && setSkillPrompt(null)}
      >
        <div class="w-[480px] max-w-[calc(100vw-24px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-zinc-900">
            <div class="text-sm font-semibold">安装 Skill</div>
            <div class="text-xs text-zinc-500 mt-0.5">{p.entry.name}</div>
          </div>
          <div class="px-5 py-4 space-y-3">
            <ScopeRadio
              value={p.scope}
              onChange={(v) => setSkillPrompt({ ...p, scope: v })}
              target="SKILL.md"
            />
            <div class="text-[11px] text-zinc-500">
              {p.entry.source === "inline"
                ? "SKILL.md 将从 manifest 内嵌内容写入"
                : `SKILL.md 将从 ${p.entry.source} 拉取`}
            </div>
          </div>
          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
            <button
              onClick={() => setSkillPrompt(null)}
              class="px-3 py-1.5 rounded text-xs text-zinc-400 hover:bg-zinc-900"
            >
              取消
            </button>
            <button
              onClick={confirmSkillInstall}
              class="px-3 py-1.5 rounded bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
            >
              安装到 {p.scope === "user" ? "~/.claude/skills" : "项目 .claude/skills"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderMcpPrompt() {
    const p = mcpPrompt()!;
    const hints = p.entry.envHints ?? [];
    return (
      <div
        class="fixed inset-0 z-[70] bg-black/60 grid place-items-center p-4"
        onClick={(e) => e.target === e.currentTarget && setMcpPrompt(null)}
      >
        <div class="w-[540px] max-w-[calc(100vw-24px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-zinc-900">
            <div class="text-sm font-semibold">安装 MCP: {p.entry.name}</div>
            <div class="text-xs text-zinc-500 mt-0.5 font-mono truncate">
              {p.entry.transport === "stdio"
                ? `${p.entry.command} ${(p.entry.args ?? []).join(" ")}`
                : p.entry.url}
            </div>
          </div>
          <div class="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto scrollbar">
            <ScopeRadio
              value={p.scope}
              onChange={(v) => setMcpPrompt({ ...p, scope: v })}
              target="claude mcp"
            />
            <Show when={hints.length > 0}>
              <div>
                <div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                  环境变量
                </div>
                <div class="space-y-2">
                  <For each={hints}>
                    {(k) => (
                      <label class="flex items-center gap-2 text-xs">
                        <span class="w-48 shrink-0 font-mono text-zinc-400">{k}</span>
                        <input
                          type="password"
                          placeholder="留空则跳过"
                          value={p.env[k] ?? ""}
                          onInput={(e) =>
                            setMcpPrompt({
                              ...p,
                              env: { ...p.env, [k]: e.currentTarget.value },
                            })
                          }
                          class="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-100 outline-none font-mono"
                        />
                      </label>
                    )}
                  </For>
                </div>
                <div class="text-[10px] text-zinc-600 mt-2">
                  值会以明文调用 <span class="font-mono">claude mcp add -e</span> 设置。含 KEY/TOKEN/SECRET 的条目在 MCP 详情里会被打码显示。
                </div>
              </div>
            </Show>
            <Show when={p.entry.homepage}>
              <a
                href={p.entry.homepage}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[11px] text-sky-400 hover:underline"
              >
                主页 → {p.entry.homepage}
              </a>
            </Show>
          </div>
          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
            <button
              onClick={() => setMcpPrompt(null)}
              class="px-3 py-1.5 rounded text-xs text-zinc-400 hover:bg-zinc-900"
            >
              取消
            </button>
            <button
              onClick={confirmMcpInstall}
              class="px-3 py-1.5 rounded bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
            >
              安装到 {p.scope}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderPluginPrompt() {
    const p = pluginPrompt()!;
    const perms = p.entry.permissions ?? [];
    return (
      <div
        class="fixed inset-0 z-[70] bg-black/60 grid place-items-center p-4"
        onClick={(e) => e.target === e.currentTarget && setPluginPrompt(null)}
      >
        <div class="w-[520px] max-w-[calc(100vw-24px)] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div class="px-5 py-4 border-b border-zinc-900">
            <div class="text-sm font-semibold">安装 Plugin: {p.entry.name}</div>
            <div class="text-xs text-zinc-500 mt-0.5 font-mono truncate">
              {p.entry.id}@{p.entry.version}
            </div>
          </div>
          <div class="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto scrollbar">
            <p class="text-[12px] text-zinc-400">{p.entry.description}</p>
            <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div class="text-[11px] uppercase tracking-wider text-amber-300 mb-1.5">
                ⚠ 所需权限
              </div>
              <Show
                when={perms.length > 0}
                fallback={
                  <div class="text-[11px] text-amber-100/70">无（最小权限）</div>
                }
              >
                <div class="flex gap-1 flex-wrap">
                  <For each={perms}>
                    {(perm) => (
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-mono">
                        {perm}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
              <div class="text-[10px] text-amber-100/70 mt-2 leading-relaxed">
                Plugin 会在 host Node 进程内加载,拥有完整 fs/network 权限。只安装你信任的作者发布的 plugin。
              </div>
            </div>
            <div class="text-[11px] text-zinc-500">
              写入位置: <span class="font-mono text-zinc-400">~/.rcc/plugins/{p.entry.id}/</span>
            </div>
            <div class="text-[11px] text-zinc-500">
              安装后默认不启用;需要在 Plugins 页手动启用,并<span class="text-zinc-300">重启 host</span> 让变更生效。
            </div>
            <Show when={p.entry.homepage}>
              <a
                href={p.entry.homepage}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[11px] text-sky-400 hover:underline"
              >
                主页 → {p.entry.homepage}
              </a>
            </Show>
          </div>
          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-end gap-2">
            <button
              onClick={() => setPluginPrompt(null)}
              class="px-3 py-1.5 rounded text-xs text-zinc-400 hover:bg-zinc-900"
            >
              取消
            </button>
            <button
              onClick={confirmPluginInstall}
              class="px-3 py-1.5 rounded bg-gradient-to-r from-orange-500 to-rose-500 text-white text-xs font-medium"
            >
              确认安装
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function TabBtn(props: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={props.onClick}
      class={`text-xs px-3 py-2 border-b-2 transition ${
        props.active
          ? "border-orange-500 text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {props.label}
      <span
        class={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
          props.active ? "bg-orange-500/20 text-orange-300" : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {props.count}
      </span>
    </button>
  );
}

function EmptyCard(props: { label: string }) {
  return (
    <div class="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
      {props.label}
    </div>
  );
}

function InstallBadge(props: { state?: InstallState[string] }) {
  return (
    <Show when={props.state}>
      {(s) => (
        <span
          class={`text-[10px] px-1.5 py-0.5 rounded ${
            s().status === "ok"
              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
              : s().status === "error"
                ? "bg-rose-500/10 text-rose-300 border border-rose-500/30"
                : "bg-zinc-800 text-zinc-400"
          }`}
          title={s().message}
        >
          {s().status === "ok" ? "✓ 已安装" : s().status === "error" ? "✗ 失败" : "安装中…"}
        </span>
      )}
    </Show>
  );
}

function SkillCard(props: {
  entry: MarketSkillEntry;
  state?: InstallState[string];
  onInstall: () => void;
}) {
  return (
    <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2 hover:border-zinc-700 transition">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-9 h-9 rounded-lg bg-zinc-800 grid place-items-center shrink-0 text-lg">
          {iconFor(props.entry.name)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm truncate">{props.entry.name}</span>
            <Show when={props.entry.author}>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                @{props.entry.author}
              </span>
            </Show>
            <InstallBadge state={props.state} />
          </div>
          <div class="text-[11px] text-zinc-500 font-mono truncate">{props.entry.id}</div>
        </div>
      </div>
      <p class="text-[12px] text-zinc-400 leading-relaxed line-clamp-2 min-h-[32px]">
        {props.entry.description || <span class="italic text-zinc-600">（无描述）</span>}
      </p>
      <div class="flex items-center justify-between gap-2 mt-1">
        <div class="flex gap-1 flex-wrap min-w-0">
          <For each={(props.entry.tags ?? []).slice(0, 4)}>
            {(t) => (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {t}
              </span>
            )}
          </For>
        </div>
        <button
          onClick={props.onInstall}
          disabled={props.state?.status === "installing"}
          class="text-[11px] px-2.5 py-1 rounded bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 disabled:opacity-50"
        >
          📥 安装
        </button>
      </div>
      <Show when={props.state?.status === "error" && props.state?.message}>
        <div class="text-[10px] text-rose-400 mt-1 break-words">
          {props.state!.message}
        </div>
      </Show>
    </div>
  );
}

function McpCard(props: {
  entry: MarketMcpEntry;
  state?: InstallState[string];
  onInstall: () => void;
}) {
  return (
    <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2 hover:border-zinc-700 transition">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-9 h-9 rounded-lg bg-zinc-800 grid place-items-center shrink-0 text-lg">
          {iconFor(props.entry.name)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm truncate">{props.entry.name}</span>
            <span
              class={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                props.entry.transport === "stdio"
                  ? "bg-violet-500/10 text-violet-300 border border-violet-500/20"
                  : "bg-sky-500/10 text-sky-300 border border-sky-500/20"
              }`}
            >
              {props.entry.transport}
            </span>
            <Show when={props.entry.author}>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                @{props.entry.author}
              </span>
            </Show>
            <InstallBadge state={props.state} />
          </div>
          <div class="text-[11px] text-zinc-500 font-mono truncate">{props.entry.id}</div>
        </div>
      </div>
      <p class="text-[12px] text-zinc-400 leading-relaxed line-clamp-2 min-h-[32px]">
        {props.entry.description || <span class="italic text-zinc-600">（无描述）</span>}
      </p>
      <Show when={(props.entry.envHints ?? []).length > 0}>
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[10px] text-zinc-600">env:</span>
          <For each={props.entry.envHints ?? []}>
            {(k) => (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono">
                {k}
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center justify-between gap-2 mt-1">
        <div class="flex gap-1 flex-wrap min-w-0">
          <For each={(props.entry.tags ?? []).slice(0, 4)}>
            {(t) => (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {t}
              </span>
            )}
          </For>
        </div>
        <button
          onClick={props.onInstall}
          disabled={props.state?.status === "installing"}
          class="text-[11px] px-2.5 py-1 rounded bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 disabled:opacity-50"
        >
          📥 安装
        </button>
      </div>
      <Show when={props.state?.status === "error" && props.state?.message}>
        <div class="text-[10px] text-rose-400 mt-1 break-words">
          {props.state!.message}
        </div>
      </Show>
    </div>
  );
}

function ScopeRadio(props: {
  value: MarketScope;
  onChange: (v: MarketScope) => void;
  target: string;
}) {
  return (
    <div>
      <div class="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">作用域</div>
      <div class="flex gap-2">
        <label
          class={`flex-1 px-3 py-2 rounded-lg border cursor-pointer text-xs ${
            props.value === "user"
              ? "border-orange-500/50 bg-orange-500/10 text-orange-200"
              : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
          }`}
        >
          <input
            type="radio"
            class="sr-only"
            checked={props.value === "user"}
            onChange={() => props.onChange("user")}
          />
          <div class="font-medium">用户</div>
          <div class="text-[10px] text-zinc-500 mt-0.5">
            {props.target === "SKILL.md" ? "~/.claude/skills" : "claude mcp add -s user"}
          </div>
        </label>
        <label
          class={`flex-1 px-3 py-2 rounded-lg border cursor-pointer text-xs ${
            props.value === "project"
              ? "border-orange-500/50 bg-orange-500/10 text-orange-200"
              : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
          }`}
        >
          <input
            type="radio"
            class="sr-only"
            checked={props.value === "project"}
            onChange={() => props.onChange("project")}
          />
          <div class="font-medium">项目</div>
          <div class="text-[10px] text-zinc-500 mt-0.5">
            {props.target === "SKILL.md" ? "&lt;cwd&gt;/.claude/skills" : "claude mcp add -s project"}
          </div>
        </label>
      </div>
    </div>
  );
}

function PluginCard(props: {
  entry: MarketPluginEntry;
  state?: InstallState[string];
  onInstall: () => void;
}) {
  const perms = () => props.entry.permissions ?? [];
  const isTarball = () => props.entry.source.mode === "tarball";
  return (
    <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2 hover:border-zinc-700 transition">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-9 h-9 rounded-lg bg-zinc-800 grid place-items-center shrink-0 text-lg">
          {iconFor(props.entry.name)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm truncate">{props.entry.name}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              v{props.entry.version}
            </span>
            <Show when={props.entry.author}>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                @{props.entry.author}
              </span>
            </Show>
            <InstallBadge state={props.state} />
          </div>
          <div class="text-[11px] text-zinc-500 font-mono truncate">{props.entry.id}</div>
        </div>
      </div>
      <p class="text-[12px] text-zinc-400 leading-relaxed line-clamp-2 min-h-[32px]">
        {props.entry.description || <span class="italic text-zinc-600">（无描述）</span>}
      </p>
      <Show when={perms().length > 0}>
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[10px] text-amber-500/80">⚠ perms:</span>
          <For each={perms()}>
            {(p) => (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono border border-amber-500/20">
                {p}
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center justify-between gap-2 mt-1">
        <div class="flex gap-1 flex-wrap min-w-0">
          <For each={(props.entry.tags ?? []).slice(0, 4)}>
            {(t) => (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                {t}
              </span>
            )}
          </For>
        </div>
        <button
          onClick={props.onInstall}
          disabled={props.state?.status === "installing" || isTarball()}
          title={isTarball() ? "tarball 安装留待 M9" : undefined}
          class="text-[11px] px-2.5 py-1 rounded bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 disabled:opacity-50"
        >
          📥 {isTarball() ? "（tarball, M9）" : "安装"}
        </button>
      </div>
      <Show when={props.state?.status === "error" && props.state?.message}>
        <div class="text-[10px] text-rose-400 mt-1 break-words">
          {props.state!.message}
        </div>
      </Show>
      <Show when={props.state?.status === "ok" && props.state?.message}>
        <div class="text-[10px] text-emerald-400 mt-1 break-words">
          {props.state!.message}
        </div>
      </Show>
    </div>
  );
}
