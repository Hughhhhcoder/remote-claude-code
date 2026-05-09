import { createSignal, Show, For, type JSX } from "solid-js";
import type { RccClient } from "./client.ts";
import { McpTab } from "./McpTab.tsx";
import { SkillsTab } from "./SkillsTab.tsx";
import { CommandsTab } from "./CommandsTab.tsx";
import { SubagentsTab } from "./SubagentsTab.tsx";
import { HooksTab } from "./HooksTab.tsx";
import { PermissionsTab } from "./PermissionsTab.tsx";
import { WorkflowsTab } from "./WorkflowsTab.tsx";
import { PromptsTab } from "./PromptsTab.tsx";
import { StartersTab } from "./StartersTab.tsx";
import type { WorkflowRunRequest } from "./workflow-runner.ts";

type TabKey =
  | "skills"
  | "mcp"
  | "commands"
  | "subagents"
  | "hooks"
  | "permissions"
  | "workflows"
  | "prompts"
  | "starters";

interface TabSpec {
  key: TabKey;
  label: string;
  icon: string;
  accent: string;
  render: (ctx: {
    client: RccClient;
    activeSid: string | null;
    onRunWorkflow: (req: WorkflowRunRequest) => void;
  }) => JSX.Element;
}

const TABS: readonly TabSpec[] = [
  {
    key: "skills",
    label: "Skills",
    icon: "✨",
    accent: "text-orange-400",
    render: (ctx) => <SkillsTab client={ctx.client} activeSid={ctx.activeSid} />,
  },
  {
    key: "mcp",
    label: "MCP Servers",
    icon: "🔌",
    accent: "text-sky-400",
    render: (ctx) => <McpTab client={ctx.client} />,
  },
  {
    key: "commands",
    label: "Slash Commands",
    icon: "/",
    accent: "text-violet-400",
    render: (ctx) => <CommandsTab client={ctx.client} />,
  },
  {
    key: "subagents",
    label: "Subagents",
    icon: "🤖",
    accent: "text-emerald-400",
    render: (ctx) => <SubagentsTab client={ctx.client} />,
  },
  {
    key: "hooks",
    label: "Hooks",
    icon: "⚡",
    accent: "text-rose-400",
    render: (ctx) => <HooksTab client={ctx.client} />,
  },
  {
    key: "permissions",
    label: "Permissions",
    icon: "🛡",
    accent: "text-amber-400",
    render: (ctx) => <PermissionsTab client={ctx.client} />,
  },
  {
    key: "workflows",
    label: "Workflows",
    icon: "⚙",
    accent: "text-teal-300",
    render: (ctx) => (
      <WorkflowsTab
        client={ctx.client}
        activeSid={ctx.activeSid}
        onRun={ctx.onRunWorkflow}
      />
    ),
  },
  {
    key: "prompts",
    label: "Prompts",
    icon: "📝",
    accent: "text-amber-300",
    render: (ctx) => <PromptsTab client={ctx.client} />,
  },
  {
    key: "starters",
    label: "Starters",
    icon: "🚀",
    accent: "text-indigo-300",
    render: (ctx) => <StartersTab client={ctx.client} />,
  },
] as const;

interface Props {
  open: boolean;
  client: RccClient;
  activeSid: string | null;
  onClose: () => void;
  onRunWorkflow: (req: WorkflowRunRequest) => void;
}

/**
 * Full-screen config modal mirroring mockup/config.html. Each tab is filled
 * by a dedicated feature agent; this shell only lays out navigation.
 */
export function ConfigView(props: Props) {
  const [active, setActive] = createSignal<TabKey>("skills");

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="h-full w-full flex flex-col">
          {/* Top bar */}
          <div class="h-14 flex items-center justify-between px-6 border-b border-zinc-900 shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 grid place-items-center font-bold text-xs text-white">
                R
              </div>
              <div class="text-sm font-semibold">Claude Code · 配置</div>
              <span class="text-xs text-zinc-500">
                所有改动自动同步到所有配对设备
              </span>
            </div>
            <button
              onClick={props.onClose}
              class="px-3 py-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 text-sm"
            >
              ✕ 关闭
            </button>
          </div>

          <div class="flex-1 grid" style="grid-template-columns: 220px 1fr; min-height: 0;">
            {/* Sidebar nav */}
            <aside class="border-r border-zinc-900 overflow-y-auto scrollbar p-3">
              <div class="text-[10px] uppercase tracking-widest text-zinc-600 px-2 py-2">
                常用配置
              </div>
              <For each={TABS}>
                {(t) => (
                  <button
                    onClick={() => setActive(t.key)}
                    class={`w-full flex items-center gap-3 px-3 py-2 rounded-lg mb-0.5 text-left text-sm transition ${
                      active() === t.key
                        ? "bg-zinc-900 border border-zinc-800"
                        : "hover:bg-zinc-900/60"
                    }`}
                  >
                    <span class={`w-5 h-5 rounded grid place-items-center text-[11px] ${t.accent}`}>
                      {t.icon}
                    </span>
                    <span class={active() === t.key ? "text-zinc-100" : "text-zinc-300"}>
                      {t.label}
                    </span>
                  </button>
                )}
              </For>
            </aside>

            {/* Content */}
            <div class="overflow-y-auto scrollbar">
              <For each={TABS}>
                {(t) => (
                  <Show when={active() === t.key}>
                    <div class="max-w-5xl mx-auto px-8 py-8">
                      {t.render({
                        client: props.client,
                        activeSid: props.activeSid,
                        onRunWorkflow: props.onRunWorkflow,
                      })}
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
