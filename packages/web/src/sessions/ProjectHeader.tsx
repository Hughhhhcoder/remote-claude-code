import type { JSX } from "solid-js";
import type { ProjectMeta, ProjectColor } from "@rcc/protocol";

/**
 * ProjectHeader — collapsible row for a project in the sidebar.
 *
 * Renders: chevron · color dot · name · session count · (+) on hover/tap.
 * Uses font-sans (chrome). Click on the main label toggles collapsed;
 * explicit `+` button calls onNewSession without toggling.
 *
 * Visual:
 *   - Hover: bg-bg-surfaceStrong (desktop); on mobile the `+` is always visible
 *     as a tap target (min-h-[44px]).
 *   - Color dot uses project.color palette (orange/teal/violet/pink/green).
 */

const DOT_CLS: Record<ProjectColor, string> = {
  orange: "bg-orange-400",
  teal: "bg-teal-400",
  violet: "bg-violet-400",
  pink: "bg-pink-400",
  green: "bg-emerald-400",
};

function dotColor(color: ProjectColor | undefined): string {
  return DOT_CLS[(color ?? "orange") as ProjectColor] ?? DOT_CLS.orange;
}

export interface ProjectHeaderProps {
  project: ProjectMeta;
  sessionCount: number;
  collapsed: boolean;
  onToggle: () => void;
  onNewSession: () => void;
}

export function ProjectHeader(props: ProjectHeaderProps): JSX.Element {
  return (
    <div
      class={[
        "group flex items-center gap-1.5 px-2 min-h-[44px] md:min-h-0 md:py-1.5",
        "rounded-md hover:bg-bg-surfaceStrong transition duration-fast ease-rcc",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={props.onToggle}
        class={[
          "flex items-center gap-1.5 min-w-0 flex-1 text-left py-2.5 md:py-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm",
        ].join(" ")}
        aria-expanded={!props.collapsed}
        title={props.collapsed ? "展开" : "折叠"}
      >
        <span
          class="text-[10px] text-text-muted w-2 shrink-0 font-sans"
          aria-hidden="true"
        >
          {props.collapsed ? "▶" : "▼"}
        </span>
        <span
          class={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(props.project.color)}`}
          aria-hidden="true"
        />
        <span class="text-[13px] font-sans font-medium text-text-primary truncate">
          {props.project.name}
        </span>
        <span class="text-[11px] font-sans text-text-muted shrink-0">
          {props.sessionCount}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onNewSession();
        }}
        class={[
          "shrink-0 inline-flex items-center justify-center",
          "w-8 h-8 md:w-6 md:h-6 rounded-sm font-sans text-sm",
          "text-text-muted hover:text-accent hover:bg-accent-bg",
          "md:opacity-0 md:group-hover:opacity-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          "transition duration-fast ease-rcc",
        ].join(" ")}
        title={`在 ${props.project.name} 中新建会话`}
        aria-label={`在 ${props.project.name} 中新建会话`}
      >
        +
      </button>
    </div>
  );
}

export default ProjectHeader;
