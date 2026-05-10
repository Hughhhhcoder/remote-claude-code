import {
  createEffect,
  createMemo,
  createSignal,
  For,
  lazy,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
  type JSX,
} from "solid-js";
import type { RccClient } from "../client.ts";
import type { WorkflowRunRequest } from "../workflow-runner.ts";
import { TextInput } from "../primitives/TextInput.tsx";
import {
  SETTINGS_TABS,
  filterTabs,
  findTabById,
  type SettingsTabEntry,
  type SettingsTabId,
} from "./tabsConfig.ts";

// Lazy wrappers — each tab owns its own props contract.
const SkillsTab      = lazy(() => import("../SkillsTab.tsx").then((m) => ({ default: m.SkillsTab })));
const McpTab         = lazy(() => import("../McpTab.tsx").then((m) => ({ default: m.McpTab })));
const CommandsTab    = lazy(() => import("../CommandsTab.tsx").then((m) => ({ default: m.CommandsTab })));
const SubagentsTab   = lazy(() => import("../SubagentsTab.tsx").then((m) => ({ default: m.SubagentsTab })));
const HooksTab       = lazy(() => import("../HooksTab.tsx").then((m) => ({ default: m.HooksTab })));
const PermissionsTab = lazy(() => import("../PermissionsTab.tsx").then((m) => ({ default: m.PermissionsTab })));
const StartersTab    = lazy(() => import("../StartersTab.tsx").then((m) => ({ default: m.StartersTab })));
const WorkflowsTab   = lazy(() => import("../WorkflowsTab.tsx").then((m) => ({ default: m.WorkflowsTab })));
const PromptsTab     = lazy(() => import("../PromptsTab.tsx").then((m) => ({ default: m.PromptsTab })));
const PluginsTab     = lazy(() => import("../PluginsTab.tsx").then((m) => ({ default: m.PluginsTab })));
const NotificationsTab = lazy(() => import("../push/PushSettingsPane.tsx").then((m) => ({ default: m.PushSettingsPane })));

export interface SettingsPaneProps {
  client: RccClient;
  activeSid: string | null;
  /** Tab id to open at mount. Defaults to "skills". */
  initialTabId?: string;
  /** Called to dismiss the pane (dialog close). */
  onClose: () => void;
  /** Workflow-run callback passed through to WorkflowsTab. */
  onRunWorkflow?: (req: WorkflowRunRequest) => void;
}

const HASH_PREFIX = "#settings/";

function readHashTab(): SettingsTabId | undefined {
  if (typeof window === "undefined") return undefined;
  const h = window.location.hash;
  if (!h.startsWith(HASH_PREFIX)) return undefined;
  const id = h.slice(HASH_PREFIX.length);
  const match = findTabById(id);
  return match?.id;
}

function coerceInitial(id: string | undefined): SettingsTabId {
  return findTabById(id)?.id ?? "skills";
}

/**
 * Unified Settings pane shell. Mounts one of the 10 existing *Tab components
 * based on the active tab id. Responsive: sidebar (desktop) / horizontal
 * strip (tablet + mobile).
 */
export function SettingsPane(props: SettingsPaneProps): JSX.Element {
  const [active, setActive] = createSignal<SettingsTabId>(
    coerceInitial(readHashTab() ?? props.initialTabId)
  );
  const [query, setQuery] = createSignal("");
  const [searchExpanded, setSearchExpanded] = createSignal(false);

  const visibleTabs = createMemo<readonly SettingsTabEntry[]>(() => filterTabs(query()));

  // Keep URL hash in sync (best-effort, silent if window missing).
  createEffect(() => {
    const id = active();
    if (typeof window !== "undefined") {
      const desired = `${HASH_PREFIX}${id}`;
      if (window.location.hash !== desired) {
        history.replaceState(null, "", desired);
      }
    }
  });

  // Listen for external hash changes (back/forward).
  onMount(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      const id = readHashTab();
      if (id && id !== active()) setActive(id);
    };
    window.addEventListener("hashchange", handler);
    onCleanup(() => window.removeEventListener("hashchange", handler));
  });

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      const list = visibleTabs();
      if (list.length > 0 && list.length < 10) {
        setActive(list[0]!.id);
        setQuery("");
      }
    } else if (e.key === "Escape") {
      if (query()) {
        setQuery("");
      } else {
        props.onClose();
      }
    }
  }

  return (
    <div class="flex flex-col h-full w-full bg-bg-app text-text-primary">
      {/* Header */}
      <header class="shrink-0 h-14 sm:h-12 flex items-center gap-2 sm:gap-3 px-3 sm:px-5 border-b border-border-subtle">
        <h2 class="font-serif text-[16px] text-text-primary truncate">设置</h2>
        <div class="ml-auto flex items-center gap-2">
          <div
            class={`transition-all duration-150 ${
              searchExpanded() ? "w-48 sm:w-56" : "w-9 sm:w-48"
            }`}
          >
            <Show
              when={searchExpanded() || typeof window === "undefined" || window.innerWidth >= 640}
              fallback={
                <button
                  type="button"
                  aria-label="搜索设置"
                  class="h-11 w-9 grid place-items-center rounded-md text-text-muted hover:bg-bg-surfaceStrong"
                  onClick={() => setSearchExpanded(true)}
                >
                  🔎
                </button>
              }
            >
              <TextInput
                value={query()}
                onInput={setQuery}
                placeholder="搜索设置…"
                onKeyDown={onSearchKeydown}
                onBlur={() => !query() && setSearchExpanded(false)}
              />
            </Show>
          </div>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={props.onClose}
            class="w-11 h-11 sm:w-9 sm:h-9 grid place-items-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-surfaceStrong"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Mobile + tablet: horizontal strip */}
      <nav
        class="lg:hidden shrink-0 border-b border-border-subtle overflow-x-auto no-scrollbar"
        role="tablist"
        aria-label="Settings tabs"
      >
        <div class="flex items-stretch">
          <For each={visibleTabs()}>
            {(t) => (
              <button
                type="button"
                role="tab"
                aria-selected={active() === t.id}
                onClick={() => setActive(t.id)}
                class={`h-11 sm:h-10 px-4 flex items-center gap-2 whitespace-nowrap text-sm transition border-b-2 ${
                  active() === t.id
                    ? "border-accent text-accent bg-accent-bg/40"
                    : "border-transparent text-text-secondary hover:bg-bg-surfaceStrong"
                }`}
              >
                <span aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            )}
          </For>
        </div>
      </nav>

      {/* Body */}
      <div class="flex-1 min-h-0 grid lg:grid-cols-[14rem_1fr]">
        {/* Desktop sidebar */}
        <aside
          class="hidden lg:flex flex-col w-56 border-r border-border-subtle overflow-y-auto p-2 gap-0.5"
          role="tablist"
          aria-label="Settings tabs"
        >
          <For each={visibleTabs()}>
            {(t) => (
              <button
                type="button"
                role="tab"
                aria-selected={active() === t.id}
                onClick={() => setActive(t.id)}
                class={`h-9 px-3 flex items-center gap-2 text-sm text-left rounded-md transition border-l-2 ${
                  active() === t.id
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-transparent text-text-secondary hover:bg-bg-surfaceStrong"
                }`}
                title={t.description}
              >
                <span aria-hidden="true" class="w-4 text-center">{t.icon}</span>
                <span class="truncate">{t.label}</span>
              </button>
            )}
          </For>
          <Show when={visibleTabs().length === 0}>
            <div class="text-[11px] text-text-muted px-3 py-2">无匹配结果</div>
          </Show>
        </aside>

        {/* Content */}
        <section
          class="min-h-0 overflow-y-auto"
          role="tabpanel"
          aria-labelledby={`settings-tab-${active()}`}
        >
          <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
            <Suspense fallback={<div class="text-sm text-text-muted">加载中…</div>}>
              <Switch>
                <Match when={active() === "skills"}>
                  <SkillsTab client={props.client} activeSid={props.activeSid} />
                </Match>
                <Match when={active() === "mcp"}><McpTab client={props.client} /></Match>
                <Match when={active() === "commands"}><CommandsTab client={props.client} /></Match>
                <Match when={active() === "subagents"}><SubagentsTab client={props.client} /></Match>
                <Match when={active() === "hooks"}><HooksTab client={props.client} /></Match>
                <Match when={active() === "permissions"}><PermissionsTab client={props.client} /></Match>
                <Match when={active() === "starters"}><StartersTab client={props.client} /></Match>
                <Match when={active() === "workflows"}>
                  <WorkflowsTab
                    client={props.client}
                    activeSid={props.activeSid}
                    onRun={(req) => props.onRunWorkflow?.(req)}
                  />
                </Match>
                <Match when={active() === "prompts"}><PromptsTab client={props.client} /></Match>
                <Match when={active() === "plugins"}><PluginsTab client={props.client} /></Match>
                <Match when={active() === "notifications"}><NotificationsTab client={props.client} /></Match>
              </Switch>
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}

export default SettingsPane;
