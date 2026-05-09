import { createSignal, createMemo, createEffect, onCleanup, onMount, For, Show } from "solid-js";
import type {
  CommandSummary,
  SessionMeta,
  SkillSummary,
  SubagentSummary,
} from "@rcc/protocol";
import type { RccClient } from "./client.ts";

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

interface Item {
  id: string;
  category: Category;
  icon: string;
  label: string;
  sub?: string;
  run: () => void;
}

interface Ranked {
  item: Item;
  score: number;
}

const CATEGORY_LABEL: Record<Category, string> = {
  action: "动作",
  session: "会话",
  skill: "Skills",
  command: "Slash Commands",
  subagent: "Subagents",
  git: "Git",
};

const CACHE_TTL_MS = 60_000;

const GIT_ACTIONS: { sub: string; label: string; args: string[] }[] = [
  { sub: "status", label: "git status", args: ["status", "--short", "--branch"] },
  { sub: "diff", label: "git diff", args: ["diff", "--stat"] },
  { sub: "log", label: "git log", args: ["log", "--oneline", "-n", "20"] },
  { sub: "branch", label: "git branch", args: ["branch", "-a", "--no-color"] },
];

export function CommandPalette(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [skills, setSkills] = createSignal<SkillSummary[]>([]);
  const [commands, setCommands] = createSignal<CommandSummary[]>([]);
  const [subagents, setSubagents] = createSignal<SubagentSummary[]>([]);

  let lastFetch = 0;
  let inputRef: HTMLInputElement | undefined;

  const unsubFrame = props.client.on((frame) => {
    if (frame.t === "skill.list") setSkills(frame.skills);
    else if (frame.t === "cmd.list") setCommands(frame.commands);
    else if (frame.t === "subagent.list") setSubagents(frame.agents);
  });

  function onKeyDown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
      return;
    }
    if (!open()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const list = ranked();
      if (list.length > 0) setSelected((i) => (i + 1) % list.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const list = ranked();
      if (list.length > 0) setSelected((i) => (i - 1 + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const list = ranked();
      const pick = list[selected()];
      if (pick) {
        pick.item.run();
        close();
      }
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
      queueMicrotask(() => {
        inputRef?.focus();
        inputRef?.select();
      });
    }
  });

  function close() {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }

  function ensureData() {
    const now = Date.now();
    if (now - lastFetch < CACHE_TTL_MS) return;
    lastFetch = now;
    props.client.send({ v: 1, t: "skill.list.request" });
    props.client.send({ v: 1, t: "cmd.list.request" });
    props.client.send({ v: 1, t: "subagent.list.request" });
  }

  function runGit(args: string[]) {
    const sid = props.activeSid;
    if (!sid) return;
    props.client.send({ v: 1, t: "git.exec.request", sid, args });
  }

  function runSlash(name: string) {
    const sid = props.activeSid;
    if (!sid) return;
    props.client.write(sid, `/${name}\r`);
  }

  function runSkillTryIt(s: SkillSummary) {
    const sid = props.activeSid;
    if (!sid) return;
    props.client.write(sid, `请使用 skill: ${s.name}\r`);
  }

  function runSubagentMention(a: SubagentSummary) {
    const sid = props.activeSid;
    if (!sid) return;
    props.client.write(sid, `@${a.name} `);
  }

  const allItems = createMemo<Item[]>(() => {
    const items: Item[] = [];

    for (const a of props.actions) {
      items.push({
        id: `action:${a.id}`,
        category: "action",
        icon: a.icon,
        label: a.label,
        sub: a.hint,
        run: a.run,
      });
    }

    for (const s of props.sessions) {
      const title = s.summary?.title ?? s.title ?? s.id;
      items.push({
        id: `session:${s.id}`,
        category: "session",
        icon: s.status === "running" ? "🟢" : "💾",
        label: title,
        sub: s.id,
        run: () => props.onActivateSession(s.id),
      });
    }

    for (const s of skills()) {
      items.push({
        id: `skill:${s.id}`,
        category: "skill",
        icon: "🧩",
        label: s.name,
        sub: s.description || s.displayPath,
        run: () => runSkillTryIt(s),
      });
    }

    for (const c of commands()) {
      items.push({
        id: `cmd:${c.id}`,
        category: "command",
        icon: "/",
        label: `/${c.name}`,
        sub: c.description || c.scope,
        run: () => runSlash(c.name),
      });
    }

    for (const a of subagents()) {
      items.push({
        id: `sub:${a.id}`,
        category: "subagent",
        icon: "🤖",
        label: `@${a.name}`,
        sub: a.description || a.scope,
        run: () => runSubagentMention(a),
      });
    }

    for (const g of GIT_ACTIONS) {
      items.push({
        id: `git:${g.sub}`,
        category: "git",
        icon: "⌥",
        label: g.label,
        sub: "read-only git on active session",
        run: () => runGit(g.args),
      });
    }

    return items;
  });

  const ranked = createMemo<Ranked[]>(() => {
    const raw = query();
    const trimmed = raw.trim();
    let restrict: Category | null = null;
    let needle = trimmed;
    if (trimmed.startsWith(">")) {
      restrict = "action";
      needle = trimmed.slice(1).trim();
    } else if (trimmed.startsWith(":")) {
      restrict = "command";
      needle = trimmed.slice(1).trim();
    } else if (trimmed.startsWith("@")) {
      restrict = "session";
      needle = trimmed.slice(1).trim();
    } else if (trimmed.startsWith("#")) {
      restrict = "skill";
      needle = trimmed.slice(1).trim();
    }

    const pool = allItems().filter((i) => !restrict || i.category === restrict);
    const q = needle.toLowerCase();
    const out: Ranked[] = [];
    for (const item of pool) {
      const sc = score(q, item);
      if (sc > 0 || q === "") out.push({ item, score: sc });
    }
    out.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return categoryWeight(a.item.category) - categoryWeight(b.item.category);
    });
    return out.slice(0, 80);
  });

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center"
        style={{ "padding-top": "15vh" }}
        onClick={close}
      >
        <div
          class="w-[min(600px,94vw)] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col"
          style={{ "max-height": "70vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-900">
            <span class="text-zinc-500 text-sm">⌘K</span>
            <input
              ref={(el) => {
                inputRef = el;
              }}
              type="text"
              value={query()}
              placeholder="搜索 会话 / Skills / Commands / Subagents / Git / 动作  (前缀 > : @ #)"
              class="flex-1 bg-transparent outline-none text-sm text-zinc-100 placeholder:text-zinc-600"
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setSelected(0);
              }}
            />
            <button
              class="text-zinc-600 hover:text-zinc-300 text-xs"
              onClick={close}
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-y-auto scrollbar">
            <Show
              when={ranked().length > 0}
              fallback={<div class="p-6 text-center text-xs text-zinc-600">无匹配</div>}
            >
              <GroupedList
                ranked={ranked()}
                selected={selected()}
                onHover={setSelected}
                onPick={(i) => {
                  ranked()[i]?.item.run();
                  close();
                }}
              />
            </Show>
          </div>

          <div class="px-3 py-1.5 border-t border-zinc-900 flex items-center gap-3 text-[10px] text-zinc-600">
            <span>↑↓ 选择</span>
            <span>Enter 执行</span>
            <span>Esc 关闭</span>
            <span class="ml-auto">
              前缀: <kbd class="px-1 bg-zinc-900 rounded">{">"}</kbd> 动作{" "}
              <kbd class="px-1 bg-zinc-900 rounded">:</kbd> cmd{" "}
              <kbd class="px-1 bg-zinc-900 rounded">@</kbd> 会话{" "}
              <kbd class="px-1 bg-zinc-900 rounded">#</kbd> skill
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}

function GroupedList(props: {
  ranked: Ranked[];
  selected: number;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
}) {
  const groups = createMemo(() => {
    const m = new Map<Category, { idx: number; item: Item }[]>();
    props.ranked.forEach(({ item }, idx) => {
      const arr = m.get(item.category) ?? [];
      arr.push({ idx, item });
      m.set(item.category, arr);
    });
    return m;
  });

  const order: Category[] = ["action", "session", "command", "skill", "subagent", "git"];

  return (
    <For each={order}>
      {(cat) => (
        <Show when={groups().get(cat)?.length}>
          <div>
            <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-zinc-600">
              {CATEGORY_LABEL[cat]}
            </div>
            <For each={groups().get(cat)!}>
              {({ idx, item }) => (
                <button
                  type="button"
                  class={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 ${
                    idx === props.selected ? "bg-accent-500/15 text-accent-200" : "hover:bg-zinc-900 text-zinc-200"
                  }`}
                  onMouseMove={() => props.onHover(idx)}
                  onClick={() => props.onPick(idx)}
                >
                  <span class="w-5 text-center text-sm shrink-0">{item.icon}</span>
                  <span class="text-sm truncate flex-1">{item.label}</span>
                  <Show when={item.sub}>
                    <span class="text-[11px] text-zinc-500 truncate max-w-[260px]">{item.sub}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      )}
    </For>
  );
}

function categoryWeight(c: Category): number {
  switch (c) {
    case "action":
      return 0;
    case "command":
      return 1;
    case "session":
      return 2;
    case "skill":
      return 3;
    case "subagent":
      return 4;
    case "git":
      return 5;
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
  let ti = 0;
  let qi = 0;
  let run = 0;
  let best = 0;
  while (qi < q.length && ti < target.length) {
    if (q[qi] === target[ti]) {
      run += 1;
      best = Math.max(best, run);
      qi += 1;
      ti += 1;
    } else {
      run = 0;
      ti += 1;
    }
  }
  if (qi < q.length) return 0;
  return best * 2;
}
