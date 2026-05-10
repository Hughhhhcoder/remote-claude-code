import { createSignal, createMemo, For, Show, onCleanup, onMount, type JSX } from "solid-js";
import type {
  MarketMcpEntry,
  MarketPluginEntry,
  MarketScope,
  MarketSkillEntry,
  MarketSource,
} from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { Button } from "../primitives/Button.tsx";
import { Card } from "../primitives/Card.tsx";
import { Chip } from "../primitives/Chip.tsx";
import { EmptyState } from "../primitives/EmptyState.tsx";
import { Spinner } from "../primitives/Spinner.tsx";
import { TextInput } from "../primitives/TextInput.tsx";

/**
 * MarketplacePane — Claude-UX responsive pane migrating MarketplaceView.tsx.
 * Uses market.catalog.request / market.catalog / market.install.{skill,mcp,plugin}
 * and market.{skill,mcp,plugin}.installed frames (unchanged).
 */

export interface MarketplacePaneProps { client: RccClient; onClose?: () => void; }

type Category = "all" | "skills" | "mcps" | "plugins";
type InstallStatus = "idle" | "installing" | "ok" | "error";
type InstallRecord = { status: InstallStatus; message?: string };
type AnyEntry =
  | { kind: "skill"; data: MarketSkillEntry }
  | { kind: "mcp"; data: MarketMcpEntry }
  | { kind: "plugin"; data: MarketPluginEntry };
interface Catalog { skills: MarketSkillEntry[]; mcps: MarketMcpEntry[]; plugins: MarketPluginEntry[]; sources: MarketSource[]; }

const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "all", label: "全部" },
  { key: "skills", label: "Skills" },
  { key: "mcps", label: "MCPs" },
  { key: "plugins", label: "Plugins" },
];
const ICONS = ["✨", "🔒", "🔍", "📝", "🎨", "📚", "⚙", "🧪", "🚀", "🧠", "📦"];

function iconFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ICONS[h % ICONS.length]!;
}
const blobOf = (e: AnyEntry) => {
  const d = e.data;
  return `${d.name} ${d.description} ${(d.tags ?? []).join(" ")} ${d.author ?? ""}`.toLowerCase();
};
const catLabel = (e: AnyEntry) => (e.kind === "skill" ? "Skill" : e.kind === "mcp" ? "MCP" : "Plugin");
const keyOf = (e: AnyEntry) => `${e.kind}:${e.data.id}`;
const tarballDisabled = (e: AnyEntry) => e.kind === "plugin" && e.data.source.mode === "tarball";

export function MarketplacePane(props: MarketplacePaneProps): JSX.Element {
  const [catalog, setCatalog] = createSignal<Catalog | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [cat, setCat] = createSignal<Category>("all");
  const [installs, setInstalls] = createSignal<Record<string, InstallRecord>>({});
  const [prompt, setPrompt] = createSignal<AnyEntry | null>(null);
  const [scope, setScope] = createSignal<MarketScope>("user");
  const [env, setEnv] = createSignal<Record<string, string>>({});

  const unsub = props.client.on((frame) => {
    if (frame.t === "market.catalog") {
      setCatalog({ skills: frame.skills, mcps: frame.mcps, plugins: frame.plugins ?? [], sources: frame.sources });
      setLoading(false);
      return;
    }
    const kindMap: Record<string, "skill" | "mcp" | "plugin"> = {
      "market.skill.installed": "skill", "market.mcp.installed": "mcp", "market.plugin.installed": "plugin",
    };
    const kind = kindMap[frame.t];
    if (!kind) return;
    const f = frame as { id: string; ok: boolean; error?: string; installedName?: string; pluginId?: string };
    setInstalls((s) => ({
      ...s,
      [`${kind}:${f.id}`]: {
        status: f.ok ? "ok" : "error",
        message: f.ok
          ? kind === "plugin" ? `已写入 ~/.rcc/plugins/${f.pluginId}/` : `已安装为 ${f.installedName}`
          : f.error,
      },
    }));
  });
  onCleanup(unsub);

  const refresh = (force = false) => {
    setLoading(true);
    props.client.send({ v: 1, t: "market.catalog.request", force });
  };
  onMount(() => refresh(false));

  const items = createMemo<AnyEntry[]>(() => {
    const c = catalog();
    if (!c) return [];
    const q = query().trim().toLowerCase();
    const active = cat();
    const out: AnyEntry[] = [];
    const include = (e: AnyEntry) => { if (!q || blobOf(e).includes(q)) out.push(e); };
    if (active === "all" || active === "skills") c.skills.forEach((d) => include({ kind: "skill", data: d }));
    if (active === "all" || active === "mcps") c.mcps.forEach((d) => include({ kind: "mcp", data: d }));
    if (active === "all" || active === "plugins") c.plugins.forEach((d) => include({ kind: "plugin", data: d }));
    return out;
  });

  function openPrompt(entry: AnyEntry) {
    setScope("user");
    const e: Record<string, string> = {};
    if (entry.kind === "mcp") for (const k of entry.data.envHints ?? []) e[k] = "";
    setEnv(e);
    setPrompt(entry);
  }
  function confirmInstall() {
    const p = prompt();
    if (!p) return;
    setInstalls((s) => ({ ...s, [keyOf(p)]: { status: "installing" } }));
    if (p.kind === "skill") props.client.send({ v: 1, t: "market.install.skill", id: p.data.id, scope: scope() });
    else if (p.kind === "mcp") {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(env())) if (v.trim()) clean[k] = v;
      props.client.send({ v: 1, t: "market.install.mcp", id: p.data.id, scope: scope(), env: clean });
    } else props.client.send({ v: 1, t: "market.install.plugin", id: p.data.id });
    setPrompt(null);
  }

  return (
    <div class="flex flex-col h-full bg-bg-page">
      <header class="sticky top-0 z-20 bg-bg-page border-b border-border-subtle">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 pt-3 pb-2">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="font-serif text-[15px] text-text-primary m-0 truncate">Marketplace</h2>
            <Show when={catalog()}><span class="font-sans text-[11px] text-text-muted">{items().length} 个条目</span></Show>
          </div>
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <div class="flex-1 sm:flex-none sm:w-72">
              <TextInput value={query()} onInput={setQuery} placeholder="搜索 name / tag / author…" aria-label="搜索" />
            </div>
            <button type="button" onClick={() => refresh(true)} disabled={loading()} aria-label="刷新"
              class="min-h-[44px] min-w-[44px] shrink-0 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong disabled:opacity-50 transition duration-fast ease-rcc">
              <Show when={loading()} fallback={<span aria-hidden="true">⟳</span>}><Spinner size="sm" /></Show>
            </button>
          </div>
        </div>
        <div class="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto">
          <For each={CATEGORIES}>
            {(c) => (
              <button type="button" onClick={() => setCat(c.key)} class="shrink-0 min-h-[32px]">
                <Chip size="sm" tone={cat() === c.key ? "accent" : "neutral"}>{c.label}</Chip>
              </button>
            )}
          </For>
        </div>
      </header>
      <div class="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4">
        <Show when={catalog()} fallback={
          <div class="p-8 text-center text-sm text-text-secondary">
            <Show when={loading()} fallback={<span>未加载</span>}><Spinner size="md" /></Show>
          </div>
        }>
          <Show when={items().length > 0} fallback={<EmptyState icon="📭" title="没有匹配的项目" />}>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
              <For each={items()}>{(entry) => <ItemCard entry={entry} rec={installs()[keyOf(entry)]} onInstall={openPrompt} />}</For>
            </div>
          </Show>
        </Show>
      </div>
      <Show when={prompt()}>
        {(p) => <InstallPrompt entry={p()} scope={scope()} env={env()} onScope={setScope} onEnv={setEnv} onCancel={() => setPrompt(null)} onConfirm={confirmInstall} />}
      </Show>
    </div>
  );
}

function ItemCard(props: { entry: AnyEntry; rec: InstallRecord | undefined; onInstall: (e: AnyEntry) => void }): JSX.Element {
  const installed = () => props.rec?.status === "ok";
  const busy = () => props.rec?.status === "installing";
  const version = () => (props.entry.kind === "plugin" ? `v${(props.entry.data as MarketPluginEntry).version}` : null);
  const clampStyle = { display: "-webkit-box", "-webkit-line-clamp": "2", "-webkit-box-orient": "vertical", "min-height": "32px" } as const;
  return (
    <Card padding="md" class="flex flex-col gap-2">
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-9 h-9 rounded-md bg-bg-surfaceStrong grid place-items-center shrink-0 text-lg" aria-hidden="true">{iconFor(props.entry.data.name)}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-sans font-medium text-sm text-text-primary truncate">{props.entry.data.name}</span>
            <Chip size="xs" tone="neutral">{catLabel(props.entry)}</Chip>
          </div>
          <div class="text-[11px] text-text-muted font-mono truncate">{props.entry.data.id}</div>
        </div>
      </div>
      <p class="text-[12px] text-text-secondary leading-relaxed overflow-hidden" style={clampStyle}>
        {props.entry.data.description || "（无描述）"}
      </p>
      <div class="flex items-center justify-between gap-2 mt-auto pt-1">
        <div class="min-w-0 flex items-center gap-2 text-[11px] font-mono text-text-muted truncate">
          <Show when={props.entry.data.author}><span class="truncate">@{props.entry.data.author}</span></Show>
          <Show when={version()}><span>{version()}</span></Show>
        </div>
        <Show when={!installed()} fallback={<span class="text-[11px] font-sans font-medium px-2 py-1 rounded-sm bg-success/15 text-success">已安装</span>}>
          <Button size="sm" variant="primary" loading={busy()} disabled={tarballDisabled(props.entry)}
            onClick={() => props.onInstall(props.entry)} class="min-h-[36px]"
            title={tarballDisabled(props.entry) ? "tarball 安装留待 M9" : undefined}>
            {tarballDisabled(props.entry) ? "（tarball）" : "安装"}
          </Button>
        </Show>
      </div>
      <Show when={props.rec?.status === "error" && props.rec?.message}>
        <div class="text-[10px] text-danger break-words">{props.rec!.message}</div>
      </Show>
    </Card>
  );
}

function InstallPrompt(props: {
  entry: AnyEntry; scope: MarketScope; env: Record<string, string>;
  onScope: (s: MarketScope) => void; onEnv: (e: Record<string, string>) => void;
  onCancel: () => void; onConfirm: () => void;
}): JSX.Element {
  const hints = () => (props.entry.kind === "mcp" ? (props.entry.data as MarketMcpEntry).envHints ?? [] : []);
  const scopeCls = (s: MarketScope) =>
    `flex-1 min-h-[44px] px-3 py-2 rounded-md border text-sm font-sans ${
      props.scope === s ? "border-accent bg-accent/10 text-accent"
        : "border-border-subtle bg-bg-surface text-text-secondary hover:border-border-strong"
    }`;
  return (
    <div class="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div class="w-full max-w-[520px] max-h-[calc(100vh-32px)] rounded-lg border border-border-subtle bg-bg-surface shadow-2xl flex flex-col overflow-hidden">
        <div class="px-5 py-4 border-b border-border-subtle">
          <div class="font-sans text-sm font-semibold text-text-primary">安装 {catLabel(props.entry)}: {props.entry.data.name}</div>
          <div class="text-[11px] text-text-muted font-mono truncate mt-0.5">{props.entry.data.id}</div>
        </div>
        <div class="px-5 py-4 space-y-3 overflow-y-auto">
          <Show when={props.entry.kind !== "plugin"}>
            <div>
              <div class="text-[11px] uppercase tracking-widest text-text-muted mb-1.5">作用域</div>
              <div class="flex gap-2">
                <For each={["user", "project"] as MarketScope[]}>
                  {(s) => <button type="button" onClick={() => props.onScope(s)} class={scopeCls(s)}>{s === "user" ? "用户" : "项目"}</button>}
                </For>
              </div>
            </div>
          </Show>
          <Show when={hints().length > 0}>
            <div class="space-y-2">
              <div class="text-[11px] uppercase tracking-widest text-text-muted">环境变量</div>
              <For each={hints()}>
                {(k) => <TextInput value={props.env[k] ?? ""} onInput={(v) => props.onEnv({ ...props.env, [k]: v })} label={k} type="password" placeholder="留空则跳过" />}
              </For>
            </div>
          </Show>
          <p class="text-[12px] text-text-secondary leading-relaxed">{props.entry.data.description || "（无描述）"}</p>
          <Show when={(props.entry.data.tags ?? []).length > 0}>
            <div class="flex gap-1 flex-wrap">
              <For each={props.entry.data.tags ?? []}>{(t) => <Chip size="xs" tone="neutral">{t}</Chip>}</For>
            </div>
          </Show>
        </div>
        <div class="px-5 py-3 border-t border-border-subtle flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={props.onCancel}>取消</Button>
          <Button size="sm" variant="primary" onClick={props.onConfirm}>确认安装</Button>
        </div>
      </div>
    </div>
  );
}

export default MarketplacePane;
