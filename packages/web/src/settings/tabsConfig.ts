/**
 * Registry of tabs rendered by `SettingsPane`.
 *
 * This file holds **metadata only** (id / label / icon / description).
 * The actual components are imported & rendered by `SettingsPane.tsx`
 * through a discriminating `<Show>` block because each tab takes a
 * different prop shape (e.g. WorkflowsTab needs `onRun`, SkillsTab
 * needs `activeSid`). A uniform `component()` factory would force a
 * union prop type and lose that per-tab safety.
 */

export interface SettingsTabEntry {
  /** Stable id for URL-hash / active-state. */
  id: SettingsTabId;
  /** Chinese label (primary). */
  label: string;
  /** English fallback for search. */
  labelEn: string;
  /** Emoji / glyph. */
  icon: string;
  /** Short description used for filtering. */
  description: string;
}

export type SettingsTabId =
  | "skills"
  | "mcp"
  | "commands"
  | "subagents"
  | "hooks"
  | "permissions"
  | "starters"
  | "workflows"
  | "prompts"
  | "plugins";

export const SETTINGS_TABS: readonly SettingsTabEntry[] = [
  { id: "skills",      label: "技能",       labelEn: "Skills",      icon: "🧩", description: "Agent skills and capabilities" },
  { id: "mcp",         label: "MCP",        labelEn: "MCP",         icon: "🔌", description: "Model Context Protocol servers" },
  { id: "commands",    label: "命令",       labelEn: "Commands",    icon: "⚡", description: "Slash commands and shortcuts" },
  { id: "subagents",   label: "子代理",     labelEn: "Subagents",   icon: "🤖", description: "Specialized subagents" },
  { id: "hooks",       label: "钩子",       labelEn: "Hooks",       icon: "🪝", description: "Lifecycle hooks and triggers" },
  { id: "permissions", label: "权限",       labelEn: "Permissions", icon: "🔐", description: "Tool permissions and allowlists" },
  { id: "starters",    label: "启动器",     labelEn: "Starters",    icon: "🚀", description: "Starter workflow templates" },
  { id: "workflows",   label: "工作流",     labelEn: "Workflows",   icon: "⚙",  description: "Multi-step workflows" },
  { id: "prompts",     label: "提示词",     labelEn: "Prompts",     icon: "📝", description: "Saved prompt templates" },
  { id: "plugins",     label: "插件",       labelEn: "Plugins",     icon: "🧱", description: "Installed plugins" },
] as const;

export function findTabById(id: string | undefined | null): SettingsTabEntry | undefined {
  if (!id) return undefined;
  return SETTINGS_TABS.find((t) => t.id === id);
}

/** Case-insensitive match against label / labelEn / description / id. */
export function filterTabs(query: string): readonly SettingsTabEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return SETTINGS_TABS;
  return SETTINGS_TABS.filter((t) =>
    t.id.toLowerCase().includes(q) ||
    t.label.toLowerCase().includes(q) ||
    t.labelEn.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q)
  );
}
