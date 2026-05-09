import { createSignal, createMemo, For, Show, onCleanup, onMount } from "solid-js";
import type { AuditEntry } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
}

const KIND_GROUPS: readonly { prefix: string; label: string; tone: string }[] = [
  { prefix: "auth", label: "Auth", tone: "text-rose-400 border-rose-500/40 bg-rose-500/10" },
  { prefix: "session", label: "Session", tone: "text-sky-400 border-sky-500/40 bg-sky-500/10" },
  { prefix: "share", label: "Share", tone: "text-violet-400 border-violet-500/40 bg-violet-500/10" },
  { prefix: "config", label: "Config", tone: "text-amber-400 border-amber-500/40 bg-amber-500/10" },
  { prefix: "peer", label: "Peer", tone: "text-teal-300 border-teal-500/40 bg-teal-500/10" },
  { prefix: "crash", label: "Crash", tone: "text-red-400 border-red-500/40 bg-red-500/10" },
  { prefix: "update", label: "Update", tone: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
];

function toneFor(kind: string): string {
  for (const g of KIND_GROUPS) {
    if (kind === g.prefix || kind.startsWith(g.prefix + ".")) return g.tone;
  }
  return "text-zinc-400 border-zinc-700 bg-zinc-800/30";
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd} ${hh}:${mm}:${ss}`;
}

function rangeSince(range: string): number | undefined {
  const now = Date.now();
  switch (range) {
    case "1h":
      return now - 60 * 60_000;
    case "24h":
      return now - 24 * 60 * 60_000;
    case "7d":
      return now - 7 * 24 * 60 * 60_000;
    case "30d":
      return now - 30 * 24 * 60 * 60_000;
    default:
      return undefined;
  }
}

export function AuditTab(props: Props) {
  const [entries, setEntries] = createSignal<AuditEntry[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [kindFilter, setKindFilter] = createSignal<string>("");
  const [range, setRange] = createSignal<string>("all");
  const [keyword, setKeyword] = createSignal<string>("");
  const [expanded, setExpanded] = createSignal<Set<number>>(new Set());

  const unsub = props.client.on((frame) => {
    if (frame.t === "audit.entries") {
      setEntries(frame.entries);
      setLoaded(true);
    }
  });
  onCleanup(unsub);

  function refresh() {
    const since = rangeSince(range());
    props.client.send({
      v: 1,
      t: "audit.query.request",
      kind: kindFilter() || undefined,
      since,
      limit: 500,
    });
  }

  onMount(() => {
    refresh();
  });

  const filtered = createMemo(() => {
    const kw = keyword().trim().toLowerCase();
    if (!kw) return entries();
    return entries().filter((e) => {
      const hay =
        e.kind.toLowerCase() +
        " " +
        (e.deviceId ?? "").toLowerCase() +
        " " +
        JSON.stringify(e.details).toLowerCase();
      return hay.includes(kw);
    });
  });

  function toggle(ts: number) {
    const cur = new Set(expanded());
    if (cur.has(ts)) cur.delete(ts);
    else cur.add(ts);
    setExpanded(cur);
  }

  return (
    <div>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-lg font-semibold text-zinc-100">审计日志</h2>
          <p class="text-xs text-zinc-500 mt-1">
            所有安全相关操作（配对 / 撤销 / 分享 / 权限 / MCP / Hook …）。
            存 ~/.rcc/audit.jsonl，0600，保留 30 天。
          </p>
        </div>
        <button
          onClick={refresh}
          class="px-3 py-1.5 rounded-lg text-sm border border-zinc-800 hover:bg-zinc-900"
        >
          ⟳ 刷新
        </button>
      </div>

      <div class="flex flex-wrap gap-2 mb-4">
        <select
          value={kindFilter()}
          onInput={(e) => {
            setKindFilter(e.currentTarget.value);
            refresh();
          }}
          class="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">全部类型</option>
          <For each={KIND_GROUPS}>{(g) => <option value={g.prefix}>{g.label}</option>}</For>
        </select>
        <select
          value={range()}
          onInput={(e) => {
            setRange(e.currentTarget.value);
            refresh();
          }}
          class="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="all">所有时间</option>
          <option value="1h">最近 1 小时</option>
          <option value="24h">最近 24 小时</option>
          <option value="7d">最近 7 天</option>
          <option value="30d">最近 30 天</option>
        </select>
        <input
          value={keyword()}
          onInput={(e) => setKeyword(e.currentTarget.value)}
          placeholder="关键词（kind / device / details）"
          class="flex-1 min-w-[200px] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm"
        />
      </div>

      <div class="text-xs text-zinc-500 mb-3">
        共 {filtered().length} 条{loaded() ? "" : "（加载中…）"}
      </div>

      <div class="space-y-1.5">
        <For each={filtered()}>
          {(e) => {
            const isOpen = () => expanded().has(e.ts);
            return (
              <div class="rounded-lg border border-zinc-900 bg-zinc-950">
                <button
                  class="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-900/50"
                  onClick={() => toggle(e.ts)}
                >
                  <span class="text-[10px] text-zinc-500 font-mono w-36 shrink-0">
                    {fmtTime(e.ts)}
                  </span>
                  <span
                    class={`px-2 py-0.5 rounded text-[10px] border font-mono ${toneFor(e.kind)}`}
                  >
                    {e.kind}
                  </span>
                  <span class="text-xs text-zinc-400 truncate flex-1">
                    {e.deviceId ? `dev: ${e.deviceId}` : "—"}
                    {e.ip ? ` · ${e.ip}` : ""}
                  </span>
                  <span class="text-zinc-600 text-xs">{isOpen() ? "▾" : "▸"}</span>
                </button>
                <Show when={isOpen()}>
                  <pre class="px-3 pb-3 pt-0 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-all">
                    {JSON.stringify(e.details, null, 2)}
                  </pre>
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={loaded() && filtered().length === 0}>
          <div class="text-center text-zinc-600 text-sm py-10">暂无匹配的审计记录</div>
        </Show>
      </div>
    </div>
  );
}
