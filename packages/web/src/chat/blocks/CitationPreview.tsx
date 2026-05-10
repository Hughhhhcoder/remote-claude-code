import {
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type JSX,
} from "solid-js";
import type { Frame } from "@rcc/protocol";
import { Popover } from "../../primitives/Popover";
import { Spinner } from "../../primitives/Spinner";

/**
 * CitationPreview — hover (desktop) / tap (mobile) preview card that wraps
 * an inline link in a Claude message. Three shapes are handled:
 *
 *   1. External URL  (`https://…`)   — show host + URL, no fetch.
 *   2. Local file    (`packages/x.ts`, `./a.ts`, `../a.ts`, `/abs/a.ts`)
 *                    — fetch first LOCAL_PREVIEW_LINES via `fs.read.request`
 *                      and render inside a monospace scroll block.
 *   3. Anchor ref    (`#message-id`) — ask the `CitationContext` resolver
 *                    for the message's first text segment and show a 120-
 *                    char snippet.
 *
 * The component is entirely self-contained: link rendering is identical to
 * TextBlock's previous behaviour (underlined accent link). The preview only
 * kicks in on hover/focus (desktop) or a tap intercepted on touch devices.
 *
 * Dependencies:
 *   - Popover primitive (auto-bottom-sheets under 640px — see Popover.tsx)
 *   - Optional CitationContext for `client` (fs.read) and `resolveMessage`
 *     (#anchor lookup). The component degrades gracefully when absent.
 */

// ---------------------------------------------------------------------------
// Context — provided by higher layers (ChatSurface / ChatPane); optional.
// ---------------------------------------------------------------------------

export interface CitationClient {
  send: (frame: Frame) => void;
  on: (listener: (frame: Frame) => void) => () => void;
}

export interface CitationMessageRef {
  /** First 120 chars of the message's first text segment. */
  snippet: string;
  /** Role of the referenced message, if known. */
  role?: "user" | "assistant" | "system";
}

export interface CitationContextValue {
  /** When present, CitationPreview uses `fs.read.request` for local paths. */
  client?: CitationClient;
  /** When present, CitationPreview uses this to resolve `#id` refs. */
  resolveMessage?: (id: string) => CitationMessageRef | undefined;
}

export const CitationContext = createContext<CitationContextValue>({});

export function useCitation(): CitationContextValue {
  return useContext(CitationContext);
}

// ---------------------------------------------------------------------------
// Href classification
// ---------------------------------------------------------------------------

type Kind = "url" | "local" | "anchor" | "unknown";

interface Classified {
  kind: Kind;
  /** Normalised display string (URL, path, or "#id"). */
  href: string;
  /** For "anchor" kind, the id without the `#`. */
  anchorId?: string;
  /** For "url" kind, the parsed host (no protocol). */
  host?: string;
  /** For "local" kind, the trailing filename (for header display). */
  fileName?: string;
}

function classify(raw: string): Classified {
  const href = raw.trim();
  if (!href) return { kind: "unknown", href };
  if (href.startsWith("#")) {
    return { kind: "anchor", href, anchorId: href.slice(1) };
  }
  if (/^https?:\/\//i.test(href)) {
    let host: string | undefined;
    try {
      host = new URL(href).hostname;
    } catch {
      host = undefined;
    }
    return { kind: "url", href, host };
  }
  // Treat relative / absolute unix paths as local file refs. We accept
  // `foo.ts`, `./foo.ts`, `../foo.ts`, `/abs/foo.ts`, `packages/x/y.ts`.
  // Reject obvious non-paths: empty, contains whitespace (already trimmed
  // but may have tabs), or a bare word without any `.` or `/`.
  if (/\s/.test(href)) return { kind: "unknown", href };
  const looksLikePath =
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    href.includes("/") ||
    /\.[A-Za-z0-9]+$/.test(href);
  if (!looksLikePath) return { kind: "unknown", href };
  const fileName = href.split("/").filter(Boolean).pop() ?? href;
  return { kind: "local", href, fileName };
}

// ---------------------------------------------------------------------------
// Local file fetch — first N lines, utf8 only.
// ---------------------------------------------------------------------------

const LOCAL_PREVIEW_LINES = 80;
const LOCAL_FETCH_TIMEOUT_MS = 8000;

interface LocalLoad {
  status: "idle" | "loading" | "ok" | "error";
  /** First LOCAL_PREVIEW_LINES of the file, utf8. */
  content?: string;
  /** Total line count (for "N of M" footer when truncated). */
  totalLines?: number;
  truncated?: boolean;
  error?: string;
}

function useLocalPreview(
  path: () => string,
  enabled: () => boolean,
  client: () => CitationClient | undefined,
): () => LocalLoad {
  const [state, setState] = createSignal<LocalLoad>({ status: "idle" });

  createEffect(() => {
    if (!enabled()) return;
    const c = client();
    const p = path();
    if (!c) {
      setState({ status: "error", error: "no client" });
      return;
    }
    setState({ status: "loading" });

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const off = c.on((frame) => {
      if (frame.t === "fs.read" && frame.path === p) {
        if (timeout) clearTimeout(timeout);
        if (frame.encoding !== "utf8") {
          setState({ status: "error", error: "binary" });
          return;
        }
        const allLines = frame.content.split("\n");
        const trimmed = allLines.slice(0, LOCAL_PREVIEW_LINES).join("\n");
        setState({
          status: "ok",
          content: trimmed,
          totalLines: allLines.length,
          truncated:
            Boolean(frame.truncated) || allLines.length > LOCAL_PREVIEW_LINES,
        });
      } else if (frame.t === "error" && frame.code === "fs_read_failed") {
        if (timeout) clearTimeout(timeout);
        setState({ status: "error", error: frame.message ?? "read failed" });
      }
    });

    c.send({ v: 1, t: "fs.read.request", path: p });
    timeout = setTimeout(() => {
      setState((prev) =>
        prev.status === "loading"
          ? { status: "error", error: "timeout" }
          : prev,
      );
    }, LOCAL_FETCH_TIMEOUT_MS);

    onCleanup(() => {
      off();
      if (timeout) clearTimeout(timeout);
    });
  });

  return state;
}

// ---------------------------------------------------------------------------
// Card renderers
// ---------------------------------------------------------------------------

function UrlCard(props: { href: string; host?: string }): JSX.Element {
  return (
    <div class="p-3 max-w-[320px]">
      <div class="text-[11px] font-mono text-text-muted mb-1 truncate">
        {props.host ?? "external"}
      </div>
      <div
        class="text-[12px] text-text-primary break-all line-clamp-3"
        title={props.href}
      >
        {props.href}
      </div>
    </div>
  );
}

function AnchorCard(props: {
  anchorId: string;
  messageRef?: CitationMessageRef;
}): JSX.Element {
  return (
    <div class="p-3 max-w-[320px]">
      <div class="text-[11px] font-mono text-text-muted mb-1 truncate">
        #{props.anchorId}
        <Show when={props.messageRef?.role}>
          <span class="ml-2 text-text-secondary">[{props.messageRef!.role}]</span>
        </Show>
      </div>
      <Show
        when={props.messageRef}
        fallback={
          <div class="text-[12px] italic text-text-muted">
            无法解析消息引用
          </div>
        }
      >
        <div class="text-[12px] text-text-primary whitespace-pre-wrap break-words">
          {props.messageRef!.snippet}
        </div>
      </Show>
    </div>
  );
}

function LocalCard(props: {
  path: string;
  fileName: string;
  state: LocalLoad;
}): JSX.Element {
  return (
    <div class="max-w-[min(480px,90vw)] w-[360px]">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <span class="text-[12px]" aria-hidden="true">
          📄
        </span>
        <span
          class="font-mono text-[12px] text-text-primary truncate"
          title={props.path}
        >
          {props.fileName}
        </span>
      </div>
      <div class="max-h-[280px] overflow-auto">
        <Show when={props.state.status === "loading"}>
          <div class="flex items-center justify-center py-6">
            <Spinner color="muted" size="sm" />
          </div>
        </Show>
        <Show when={props.state.status === "error"}>
          <div class="px-3 py-3 text-[12px] font-mono text-danger">
            无法预览:{props.state.error ?? "unknown"}
          </div>
        </Show>
        <Show when={props.state.status === "ok" && props.state.content !== undefined}>
          <pre class="m-0 px-3 py-2 font-mono text-[11px] leading-snug text-text-primary whitespace-pre">
            {props.state.content}
          </pre>
        </Show>
        <Show when={props.state.status === "idle"}>
          <div class="px-3 py-3 text-[12px] font-mono text-text-muted">
            {props.path}
          </div>
        </Show>
      </div>
      <Show
        when={
          props.state.status === "ok" && props.state.totalLines !== undefined
        }
      >
        <div class="px-3 py-1.5 border-t border-border-subtle text-[11px] font-mono text-text-muted flex items-center gap-2">
          <span>
            {Math.min(LOCAL_PREVIEW_LINES, props.state.totalLines!)} /{" "}
            {props.state.totalLines} 行
          </span>
          <Show when={props.state.truncated}>
            <span class="text-warn">· 已截断</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface CitationPreviewProps {
  href: string;
  text: string;
  /** Optional extra class on the anchor for caller-specific styling. */
  class?: string;
}

/** Tailwind breakpoint `sm` mirror — matches Popover's mobile cutover. */
const MOBILE_MQ = "(max-width: 639.98px)";

export function CitationPreview(props: CitationPreviewProps): JSX.Element {
  const ctx = useCitation();
  const cls = createMemo(() => classify(props.href));

  const [open, setOpen] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  let anchorRef: HTMLAnchorElement | undefined;
  let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    onCleanup(() => mq.removeEventListener("change", sync));
  });

  const cancelHoverClose = (): void => {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  };

  const scheduleHoverClose = (): void => {
    cancelHoverClose();
    hoverCloseTimer = setTimeout(() => setOpen(false), 120);
  };

  onCleanup(cancelHoverClose);

  // --- event handlers ------------------------------------------------------
  const onPointerEnter = (e: PointerEvent): void => {
    if (mobile()) return;
    // Ignore pure touch — mobile devices may still emit pointerenter on tap.
    if (e.pointerType === "touch") return;
    cancelHoverClose();
    setOpen(true);
  };
  const onPointerLeave = (e: PointerEvent): void => {
    if (mobile()) return;
    if (e.pointerType === "touch") return;
    scheduleHoverClose();
  };
  const onFocus = (): void => {
    if (mobile()) return;
    cancelHoverClose();
    setOpen(true);
  };
  const onBlur = (): void => {
    if (mobile()) return;
    scheduleHoverClose();
  };
  const onClick = (e: MouseEvent): void => {
    // Mobile: intercept tap, open preview instead of navigating.
    if (mobile() && cls().kind !== "unknown") {
      e.preventDefault();
      setOpen(true);
    }
    // Anchor refs: suppress navigation on all breakpoints; they're in-page
    // meta, not real <a name> targets in this app.
    if (cls().kind === "anchor") {
      e.preventDefault();
      if (!mobile()) setOpen((v) => !v);
    }
  };

  // --- preview payload for local files ------------------------------------
  const localPath = (): string => cls().href;
  const localEnabled = (): boolean => open() && cls().kind === "local";
  const localState = useLocalPreview(
    localPath,
    localEnabled,
    () => ctx.client,
  );

  // --- anchor ref lookup --------------------------------------------------
  const anchorRefValue = createMemo<CitationMessageRef | undefined>(() => {
    const c = cls();
    if (c.kind !== "anchor" || !c.anchorId) return undefined;
    return ctx.resolveMessage?.(c.anchorId);
  });

  // --- href attribute: keep external links working, neuter anchors -------
  const targetHref = (): string | undefined => {
    const c = cls();
    if (c.kind === "anchor") return undefined;
    return c.href;
  };

  return (
    <>
      <a
        ref={anchorRef}
        href={targetHref()}
        target={cls().kind === "url" ? "_blank" : undefined}
        rel={cls().kind === "url" ? "noopener noreferrer" : undefined}
        class={
          "text-accent hover:text-accent-hover underline underline-offset-2 " +
          (props.class ?? "")
        }
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
        aria-describedby={open() ? "citation-preview-panel" : undefined}
      >
        {props.text}
      </a>
      <Show when={cls().kind !== "unknown"}>
        <Popover
          open={open()}
          onClose={() => setOpen(false)}
          anchor={() => anchorRef}
          placement="bottom-start"
        >
          <div
            id="citation-preview-panel"
            onPointerEnter={cancelHoverClose}
            onPointerLeave={scheduleHoverClose}
          >
            <Show when={cls().kind === "url"}>
              <UrlCard href={cls().href} host={cls().host} />
            </Show>
            <Show when={cls().kind === "anchor"}>
              <AnchorCard
                anchorId={cls().anchorId ?? ""}
                messageRef={anchorRefValue()}
              />
            </Show>
            <Show when={cls().kind === "local"}>
              <LocalCard
                path={cls().href}
                fileName={cls().fileName ?? cls().href}
                state={localState()}
              />
            </Show>
          </div>
        </Popover>
      </Show>
    </>
  );
}

export default CitationPreview;
