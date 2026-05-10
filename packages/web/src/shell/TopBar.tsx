import { Show, createMemo, type JSX } from "solid-js";
import { IconButton } from "../primitives/IconButton";

/**
 * TopBar — Phase 2-C responsive header for RCC v0.2.
 *
 * Renders one of two chromes driven by the `isCompact` prop (owned by
 * AppShell). The two modes share the same sticky/blurred root and status
 * semantics; only the slot composition differs.
 *
 *   Desktop (>= 1024px, isCompact=false): 48px tall. Full chrome.
 *     [R logo] [brand "rcc"] [·] [title] [status chip] [tunnel url]
 *     [— spacer —] [🔔] [device chip] [⚙] [sign out]
 *
 *   Compact (< 1024px, isCompact=true): 56px tall (touch target).
 *     [☰] [title + subtitle + status] [🔔 w/ badge]
 *
 * Status indicator: 6px dot. `bg-success` when connected; `bg-warn pulse-soft`
 * while connecting/slow; `bg-danger` for closed/unauthorized/readonly. Paired
 * with a one-word label in `text-text-muted text-[11px]`.
 *
 * Iconography: we use plain Unicode glyphs (☰ 🔔 ⚙ ↗) — no SVG dependency,
 * zero bytes, rendered by the platform. Size is controlled by the wrapping
 * IconButton (18-20px at md).
 */

// ---------------------------------------------------------------------------
// Types — declare ConnStatus inline to avoid a cross-module import from
// `../client.ts` (TopBar is purely presentational).
// ---------------------------------------------------------------------------

export type TopBarStatus =
  | "connected"
  | "connecting"
  | "closed"
  | "unauthorized"
  | "readonly"
  | "slow";

export interface TopBarProps {
  /** True when viewport < 1024px (tablet + phone). Owned by AppShell. */
  isCompact: boolean;
  /** Open sidebar drawer (compact hamburger). */
  onOpenDrawer: () => void;
  /** Open inbox (bell). */
  onOpenInbox: () => void;
  /** Open settings (desktop gear). */
  onOpenSettings: () => void;
  /** Active session title. */
  title?: string;
  /** Active session cwd/path (compact only). */
  subtitle?: string;
  /** Transport / connection state. */
  status: TopBarStatus;
  /** Unread inbox count. */
  unreadInbox: number;
  /** Live tunnel url (desktop only). Click copies to clipboard. */
  tunnelUrl?: string | null;
  /** Current device label (desktop chip). */
  deviceName?: string | null;
  /** Sign-out handler (desktop button). Optional. */
  onSignOut?: () => void;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

interface StatusMeta {
  dot: string; // tailwind bg-* class (incl. optional pulse-soft)
  label: string; // one-word zh label
  title: string; // tooltip / aria
}

function statusMeta(s: TopBarStatus): StatusMeta {
  switch (s) {
    case "connected":
      return { dot: "bg-success", label: "已连接", title: "已连接" };
    case "connecting":
      return {
        dot: "bg-warn pulse-soft",
        label: "连接中",
        title: "正在连接",
      };
    case "slow":
      return {
        dot: "bg-warn pulse-soft",
        label: "较慢",
        title: "连接较慢",
      };
    case "readonly":
      return { dot: "bg-danger", label: "只读", title: "只读模式" };
    case "unauthorized":
      return { dot: "bg-danger", label: "未授权", title: "未授权" };
    case "closed":
    default:
      return { dot: "bg-danger", label: "已断开", title: "连接已关闭" };
  }
}

// ---------------------------------------------------------------------------
// Sub-parts
// ---------------------------------------------------------------------------

function LogoMark(): JSX.Element {
  return (
    <div
      class={
        "w-7 h-7 rounded-md shrink-0 " +
        "bg-gradient-to-br from-accent to-accent-hover " +
        "flex items-center justify-center text-[13px] font-semibold " +
        "text-bg-surface select-none"
      }
      aria-hidden="true"
    >
      R
    </div>
  );
}

function StatusDot(props: { status: TopBarStatus }): JSX.Element {
  const meta = createMemo(() => statusMeta(props.status));
  return (
    <span
      class={
        "inline-block w-1.5 h-1.5 rounded-full shrink-0 " + meta().dot
      }
      title={meta().title}
      aria-label={meta().title}
      role="status"
    />
  );
}

function InboxButton(props: {
  unread: number;
  onOpen: () => void;
}): JSX.Element {
  const badge = createMemo(() =>
    props.unread > 99 ? "99+" : String(props.unread),
  );
  return (
    <div class="relative">
      <IconButton
        size="md"
        onClick={props.onOpen}
        aria-label={`打开通知,${props.unread} 未读`}
      >
        <span class="text-[16px] leading-none">🔔</span>
      </IconButton>
      <Show when={props.unread > 0}>
        <span
          class={
            "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 " +
            "rounded-full bg-accent text-bg-surface " +
            "text-[10px] font-sans font-semibold leading-4 " +
            "text-center pointer-events-none"
          }
          aria-hidden="true"
        >
          {badge()}
        </span>
      </Show>
    </div>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* ignore — clipboard API may be unavailable */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TopBar(props: TopBarProps): JSX.Element {
  const meta = createMemo(() => statusMeta(props.status));

  return (
    <div
      class={
        "w-full bg-bg-page/95 backdrop-blur " +
        "border-b border-border-subtle font-sans " +
        "sticky top-0 z-30 safe-area-padding-top safe-area-padding-x"
      }
    >
      <Show
        when={!props.isCompact}
        fallback={<CompactRow {...props} meta={meta()} />}
      >
        <DesktopRow {...props} meta={meta()} />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact row (< 1024px)
// ---------------------------------------------------------------------------

function CompactRow(
  props: TopBarProps & { meta: StatusMeta },
): JSX.Element {
  return (
    <div class="h-14 px-2 flex items-center gap-2">
      {/* Hamburger */}
      <IconButton
        size="md"
        onClick={props.onOpenDrawer}
        aria-label="打开侧边栏"
      >
        <span class="text-[18px] leading-none">☰</span>
      </IconButton>

      {/* Title + subtitle + inline status */}
      <div class="flex-1 min-w-0 flex flex-col justify-center">
        <div class="flex items-center gap-1.5 min-w-0">
          <StatusDot status={props.status} />
          <span class="text-[13px] font-medium text-text-primary truncate">
            {props.title ?? "rcc"}
          </span>
        </div>
        <Show when={props.subtitle}>
          <span class="text-[10px] font-mono text-text-muted truncate">
            {props.subtitle}
          </span>
        </Show>
      </div>

      {/* Inbox */}
      <InboxButton unread={props.unreadInbox} onOpen={props.onOpenInbox} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop row (>= 1024px)
// ---------------------------------------------------------------------------

function DesktopRow(
  props: TopBarProps & { meta: StatusMeta },
): JSX.Element {
  return (
    <div class="h-12 px-3 flex items-center gap-3">
      {/* Brand */}
      <div class="flex items-center gap-2 shrink-0">
        <LogoMark />
        <span class="text-[13px] font-semibold text-text-primary tracking-tight">
          rcc
        </span>
      </div>

      <span
        class="text-text-muted text-[13px] select-none"
        aria-hidden="true"
      >
        ·
      </span>

      {/* Session title */}
      <div class="min-w-0 flex items-center gap-2">
        <span class="text-[13px] font-medium text-text-primary truncate max-w-[240px]">
          {props.title ?? "未选择会话"}
        </span>
      </div>

      {/* Status chip */}
      <div
        class={
          "shrink-0 inline-flex items-center gap-1.5 h-6 px-2 " +
          "rounded-sm bg-bg-surface border border-border-subtle"
        }
        title={props.meta.title}
      >
        <StatusDot status={props.status} />
        <span class="text-[11px] text-text-muted leading-none">
          {props.meta.label}
        </span>
      </div>

      {/* Tunnel url */}
      <Show when={props.tunnelUrl}>
        {(url) => (
          <button
            type="button"
            onClick={() => copyText(url())}
            class={
              "shrink min-w-0 inline-flex items-center gap-1 " +
              "text-[11px] font-mono text-accent/90 truncate max-w-[200px] " +
              "hover:text-accent transition duration-fast ease-rcc " +
              "focus-visible:outline-none focus-visible:ring-2 " +
              "focus-visible:ring-accent focus-visible:ring-offset-2 " +
              "focus-visible:ring-offset-bg-page rounded-sm px-1"
            }
            title={`点击复制: ${url()}`}
            aria-label={`复制隧道地址 ${url()}`}
          >
            <span class="truncate">{url()}</span>
            <span aria-hidden="true" class="text-[10px]">
              ↗
            </span>
          </button>
        )}
      </Show>

      {/* Spacer */}
      <div class="flex-1" />

      {/* Inbox */}
      <InboxButton unread={props.unreadInbox} onOpen={props.onOpenInbox} />

      {/* Device chip */}
      <Show when={props.deviceName}>
        <span
          class={
            "shrink-0 inline-flex items-center h-6 px-2 rounded-sm " +
            "bg-bg-surface border border-border-subtle " +
            "text-[11px] font-mono text-text-secondary truncate max-w-[140px]"
          }
          title={props.deviceName ?? undefined}
        >
          {props.deviceName}
        </span>
      </Show>

      {/* Settings */}
      <IconButton
        size="md"
        onClick={props.onOpenSettings}
        aria-label="打开设置"
      >
        <span class="text-[16px] leading-none">⚙</span>
      </IconButton>

      {/* Sign out (optional) */}
      <Show when={props.onSignOut}>
        <button
          type="button"
          onClick={() => props.onSignOut?.()}
          class={
            "shrink-0 h-7 px-2 rounded-sm text-[11px] font-sans " +
            "text-text-muted hover:text-text-primary " +
            "hover:bg-bg-surface transition duration-fast ease-rcc " +
            "focus-visible:outline-none focus-visible:ring-2 " +
            "focus-visible:ring-accent focus-visible:ring-offset-2 " +
            "focus-visible:ring-offset-bg-page"
          }
          aria-label="登出"
        >
          登出
        </button>
      </Show>
    </div>
  );
}

export default TopBar;
