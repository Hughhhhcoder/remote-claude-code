import { createSignal, createMemo, createEffect, onCleanup, onMount, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type {
  CommandSummary,
  SessionMeta,
  SkillSummary,
  SubagentSummary,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { useIsMobile } from "./useIsMobile.ts";

export interface PaletteAction {
  id: string;
  label: string;
  icon: string;
  hint?: string;
  run: () => void;
}

type Props = {
  client: RccClient;
  sessions: SessionMeta[];
  activeSid: string | null;
  actions: PaletteAction[];
  onActivateSession: (sid: string) => void;
};

type Category = "action" | "session" | "skill" | "command" | "subagent" | "git";
interface Item { id: string; category: Category; icon: string; label: string; sub?: string; run: () => void; }
interface Ranked { item: Item; score: number; }

const CATEGORY_LABEL: Record<Category, string> = {
  action: "命令", session: "会话", skill: "Skills",
  command: "Slash Commands", subagent: "Subagents", git: "Git",
};
const ORDER: Category[] = ["action", "session", "command", "skill", "subagent", "git"];
const CACHE_TTL_MS = 60_000;
const GIT_ACTIONS: { sub: string; label: string; args: string[] }[] = [
  { sub: "status", label: "git status", args: ["status", "--short", "--branch"] },
  { sub: "diff", label: "git diff", args: ["diff", "--stat"] },
  { sub: "log", label: "git log", args: ["log", "--oneline", "-n", "20"] },
  { sub: "branch", label: "git branch", args: ["branch", "-a", "--no-color"] },
];
const IS_MAC = typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || "");
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

export function CommandPalette(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [skills, setSkills] = createSignal<SkillSummary[]>([]);
  const [commands, setCommands] = createSignal<CommandSummary[]>([]);
  const [subagents, setSubagents] = createSignal<SubagentSummary[]>([]);
  const isMobile = useIsMobile();

  let lastFetch = 0;
  let inputRef: HTMLInputElement | undefined;

  const unsubFrame = props.client.on((frame) => {
    if (frame.t === "skill.list") setSkills(frame.skills);
    else if (frame.t === "cmd.list") setCommands(frame.commands);
    else if (frame.t === "subagent.list") setSubagents(frame.agents);
  });

  function close() { setOpen(false); setQuery(""); setSelected(0); }

  function onKeyDown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "K")) {
      e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); return;
    }
    if (!open()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") {
      e.preventDefault(); e.stopPropagation();
      const list = ranked();
      if (list.length > 0) setSelected((i) => (i + 1) % list.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); e.stopPropagation();
      const list = ranked();
      if (list.length > 0) setSelected((i) => (i - 1 + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      const pick = ranked()[selected()];
      if (pick) { pick.item.run(); close(); }
    }
  }

  onMount(() => window.addEventListener("keydown", onKeyDown, true));
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown, true);
    unsubFrame();
  });

  createEffect(() => {
    if (open()) {
      ensureData();
      queueMicrotask(() => { inputRef?.focus(); inputRef?.select(); });
    }
  });

  function ensureData() {
    const now = Date.now();
    if (now - lastFetch < CACHE_TTL_MS) return;
    lastFetch = now;
    props.client.send({ v: 1, t: "skill.list.request" });
    props.client.send({ v: 1, t: "cmd.list.request" });
    props.client.send({ v: 1, t: "subagent.list.request" });
  }
  function runGit(args: string[]) {
    const sid = props.activeSid; if (!sid) return;
    props.client.send({ v: 1, t: "git.exec.request", sid, args });
  }
  function runSlash(name: string) {
    const sid = props.activeSid; if (!sid) return;
    props.client.write(sid, `/${name}\r`);
  }
  function runSkillTryIt(s: SkillSummary) {
    const sid = props.activeSid; if (!sid) return;
    props.client.write(sid, `请使用 skill: ${s.name}\r`);
  }
  function runSubagentMention(a: SubagentSummary) {
    const sid = props.activeSid; if (!sid) return;
    props.client.write(sid, `@${a.name} `);
  }

  const allItems = createMemo<Item[]>(() => {
    const items: Item[] = [];
    for (const a of props.actions)
      items.push({ id: `action:${a.id}`, category: "action", icon: a.icon, label: a.label, sub: a.hint, run: a.run });
    for (const s of props.sessions) {
      const title = s.summary?.title ?? s.title ?? s.id;
      items.push({
        id: `session:${s.id}`, category: "session",
        icon: s.status === "running" ? "●" : "○",
        label: title, sub: s.id.slice(0, 8),
        run: () => props.onActivateSession(s.id),
      });
    }
    for (const s of skills())
      items.push({ id: `skill:${s.id}`, category: "skill", icon: "◈", label: s.name, sub: s.description || s.displayPath, run: () => runSkillTryIt(s) });
    for (const c of commands())
      items.push({ id: `cmd:${c.id}`, category: "command", icon: "/", label: `/${c.name}`, sub: c.description || c.scope, run: () => runSlash(c.name) });
    for (const a of subagents())
      items.push({ id: `sub:${a.id}`, category: "subagent", icon: "@", label: `@${a.name}`, sub: a.description || a.scope, run: () => runSubagentMention(a) });
    for (const g of GIT_ACTIONS)
      items.push({ id: `git:${g.sub}`, category: "git", icon: "⎇", label: g.label, sub: "read-only git on active session", run: () => runGit(g.args) });
    return items;
  });

  const ranked = createMemo<Ranked[]>(() => {
    const trimmed = query().trim();
    let restrict: Category | null = null;
    let needle = trimmed;
    if (trimmed.startsWith(">")) { restrict = "action"; needle = trimmed.slice(1).trim(); }
    else if (trimmed.startsWith(":")) { restrict = "command"; needle = trimmed.slice(1).trim(); }
    else if (trimmed.startsWith("@")) { restrict = "session"; needle = trimmed.slice(1).trim(); }
    else if (trimmed.startsWith("#")) { restrict = "skill"; needle = trimmed.slice(1).trim(); }

    const pool = allItems().filter((i) => !restrict || i.category === restrict);
    const q = needle.toLowerCase();
    const out: Ranked[] = [];
    for (const item of pool) {
      const sc = score(q, item);
      if (sc > 0 || q === "") out.push({ item, score: sc });
    }
    out.sort((a, b) => (b.score !== a.score ? b.score - a.score : catWeight(a.item.category) - catWeight(b.item.category)));
    return out.slice(0, 80);
  });

  const groups = createMemo(() => {
    const m = new Map<Category, { idx: number; item: Item }[]>();
    ranked().forEach(({ item }, idx) => {
      const arr = m.get(item.category) ?? [];
      arr.push({ idx, item });
      m.set(item.category, arr);
    });
    return m;
  });

  const panelClass = () =>
    isMobile()
      ? "fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-bg-surface border-t border-border-subtle shadow-[0_-4px_32px_rgba(0,0,0,0.25)] flex flex-col max-h-[80vh]"
      : "fixed z-50 left-1/2 -translate-x-1/2 top-[15vh] w-[640px] max-w-[calc(100vw-32px)] bg-bg-surface border border-border-subtle rounded-lg shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden";

  return (
    <Show when={open()}>
      <Portal>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in"
          onClick={close}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="命令面板"
          class={panelClass()}
          style={isMobile() ? { "padding-bottom": "env(safe-area-inset-bottom)" } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={isMobile()}>
            <div class="w-12 h-1 bg-border-strong rounded-full mx-auto my-3 shrink-0" aria-hidden="true" />
          </Show>

          <div class="flex items-center gap-3 px-4 border-b border-border-subtle">
            <input
              ref={(el) => { inputRef = el; }}
              type="text"
              value={query()}
              placeholder="搜索命令 / 会话 / Skills …  (> : @ #)"
              aria-label="搜索"
              class="flex-1 bg-transparent outline-none font-serif text-[16px] h-12 sm:h-11 text-text-primary placeholder:text-text-muted"
              onInput={(e) => { setQuery(e.currentTarget.value); setSelected(0); }}
            />
            <span class="hidden sm:inline font-mono text-[11px] text-text-muted border border-border-subtle rounded px-1.5 py-0.5">
              {MOD_KEY}+K
            </span>
          </div>

          <div class="overflow-y-auto scrollbar flex-1" style={{ "max-height": isMobile() ? "60vh" : "420px" }}>
            <Show when={ranked().length > 0} fallback={<div class="p-6 text-center text-xs text-text-muted">无匹配</div>}>
              <For each={ORDER}>
                {(cat) => (
                  <Show when={groups().get(cat)?.length}>
                    <div class="py-1">
                      <div class="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-text-muted font-sans">
                        {CATEGORY_LABEL[cat]}
                      </div>
                      <For each={groups().get(cat)!}>
                        {({ idx, item }) => {
                          const active = () => idx === selected();
                          return (
                            <button
                              type="button"
                              role="option"
                              aria-selected={active()}
                              class={`w-full text-left px-4 flex items-center gap-3 h-10 sm:h-9 font-sans transition-colors ${
                                active() ? "bg-accent-bg text-accent" : "hover:bg-bg-surfaceStrong text-text-primary"
                              }`}
                              onMouseMove={() => setSelected(idx)}
                              onClick={() => { item.run(); close(); }}
                            >
                              <span class="w-5 text-center text-sm shrink-0" aria-hidden="true">{item.icon}</span>
                              <span class="text-sm truncate flex-1">{item.label}</span>
                              <Show when={item.sub}>
                                <span class={`text-[11px] truncate max-w-[260px] ${active() ? "text-accent/80" : "text-text-muted"}`}>
                                  {item.sub}
                                </span>
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                )}
              </For>
            </Show>
          </div>

          <div class="px-4 py-2 border-t border-border-subtle flex items-center gap-3 font-mono text-[11px] text-text-muted">
            <span>↑↓ 选择</span>
            <span>↵ 执行</span>
            <span class="hidden sm:inline">{MOD_KEY}+K 打开/关闭</span>
            <span class="ml-auto">Esc 关闭</span>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

function catWeight(c: Category): number {
  switch (c) {
    case "action": return 0;
    case "command": return 1;
    case "session": return 2;
    case "skill": return 3;
    case "subagent": return 4;
    case "git": return 5;
  }
}

function score(q: string, item: Item): number {
  if (!q) return 0.0001;
  const target = item.label.toLowerCase();
  const sub = (item.sub ?? "").toLowerCase();
  let s = 0;
  if (target === q) s += 100;
  if (target.startsWith(q)) s += 40;
  const ti = target.indexOf(q);
  if (ti >= 0) s += 20 - Math.min(ti, 19);
  const si = sub.indexOf(q);
  if (si >= 0) s += 6;
  s += consecutive(q, target);
  return s;
}

function consecutive(q: string, target: string): number {
  let ti = 0, qi = 0, run = 0, best = 0;
  while (qi < q.length && ti < target.length) {
    if (q[qi] === target[ti]) { run += 1; best = Math.max(best, run); qi += 1; ti += 1; }
    else { run = 0; ti += 1; }
  }
  if (qi < q.length) return 0;
  return best * 2;
}
