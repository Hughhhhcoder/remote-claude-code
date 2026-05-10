import { ErrorBoundary as SolidErrorBoundary, createSignal, Show, type JSX } from "solid-js";
import { t, tt } from "../i18n/index.ts";

/**
 * ErrorBoundary — wraps Solid's built-in <ErrorBoundary> with a friendly
 * crash page (Batch 31 redesign):
 *   - Large "出现了一个错误" heading with the Claude diamond (🔶)
 *   - Collapsed error message + stack (click to expand)
 *   - "复制错误信息" button puts a plain-text report on the clipboard
 *   - "刷新页面" primary button (window.location.reload)
 *   - "重置" secondary button that calls Solid's reset to retry rendering
 *   - Mobile-friendly at 375px: vertical stack + safe-area padding
 *
 * Use nested (e.g. scope="app" outside, scope="chat" around the chat tree) so
 * one pane crashing doesn't tear down the whole shell. Semantic tokens only —
 * must look correct in both light and dark via `data-theme` on <html>.
 */

export interface ErrorBoundaryProps {
  children: JSX.Element;
  /** Optional section label surfaced on the crash page (e.g. "对话" / "设置"). */
  scope?: string;
  /** Called with the raw error when a child throws. */
  onError?: (err: unknown) => void;
}

export interface CrashReport {
  scope: string;
  name: string;
  message: string;
  stack: string;
  userAgent: string;
  timestamp: string;
}

export function buildCrashReport(err: unknown, scope: string | undefined): CrashReport {
  const e = err as { name?: string; message?: string; stack?: string } | null;
  return {
    scope: scope ?? "global",
    name: e?.name ?? "UnknownError",
    message: e?.message ?? String(err),
    stack: e?.stack ?? "(no stack)",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
    timestamp: new Date().toISOString(),
  };
}

function formatReport(r: CrashReport): string {
  // Plain-text format, one field per line — per spec:
  //   {scope}\n{name}: {message}\n{stack}\n{userAgent}\n{timestamp}
  return `${r.scope}\n${r.name}: ${r.message}\n${r.stack}\n${r.userAgent}\n${r.timestamp}`;
}

export function ErrorBoundary(props: ErrorBoundaryProps): JSX.Element {
  return (
    <SolidErrorBoundary
      fallback={(err, reset) => {
        // Surface to onError — wire for host-side crash logging. Callback
        // errors must not cascade, hence the try/catch.
        try {
          props.onError?.(err);
        } catch {
          // swallow
        }
        const [copied, setCopied] = createSignal(false);
        const [showDetails, setShowDetails] = createSignal(false);
        const report = () => buildCrashReport(err, props.scope);

        async function copy() {
          const text = formatReport(report());
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(text);
            } else {
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.style.position = "fixed";
              ta.style.opacity = "0";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard denied — nothing else we can do
          }
        }

        function refresh() {
          try {
            window.location.reload();
          } catch {
            // ignore (e.g. SSR / tests)
          }
        }

        return (
          <div
            role="alert"
            class="min-h-full w-full flex items-center justify-center bg-bg-page text-text-primary"
            style={{
              "padding-top": "max(env(safe-area-inset-top), 16px)",
              "padding-bottom": "max(env(safe-area-inset-bottom), 16px)",
              "padding-left": "max(env(safe-area-inset-left), 16px)",
              "padding-right": "max(env(safe-area-inset-right), 16px)",
            }}
          >
            <div class="w-full max-w-[640px] flex flex-col gap-6">
              {/* Hero: diamond + big heading + scope */}
              <div class="flex flex-col items-center gap-4 text-center">
                <div
                  class="text-accent text-6xl sm:text-7xl leading-none"
                  aria-hidden="true"
                >
                  🔶
                </div>
                <h1
                  class="font-serif text-[28px] sm:text-[32px] font-medium text-text-primary m-0"
                  style={{ "font-family": "var(--font-serif)" }}
                >
                  {t("error.heading")}
                </h1>
                <Show when={props.scope}>
                  <p class="text-sm text-text-muted m-0">
                    {tt("error.scope", { scope: props.scope ?? "" })}
                  </p>
                </Show>
              </div>

              {/* Collapsed error details */}
              <div class="rounded-md border border-border-subtle bg-bg-surface">
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails()}
                  class="w-full flex items-center justify-between gap-2 px-4 py-3 text-left min-h-[44px] text-sm text-text-secondary hover:text-text-primary transition"
                >
                  <span class="flex items-center gap-2">
                    <span
                      class="inline-block transition-transform"
                      style={{
                        transform: showDetails() ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                      aria-hidden="true"
                    >
                      ▸
                    </span>
                    <span>{showDetails() ? t("error.hideDetails") : t("error.showDetails")}</span>
                  </span>
                  <span class="text-[12px] font-mono text-text-muted truncate max-w-[60%]">
                    {report().name}
                  </span>
                </button>
                <Show when={showDetails()}>
                  <div class="border-t border-border-subtle px-4 py-3 flex flex-col gap-2">
                    <div class="text-[12px] font-mono text-danger break-all">
                      {report().name}: {report().message}
                    </div>
                    <pre class="text-[11px] font-mono text-text-muted bg-bg-page rounded-md p-3 overflow-auto max-h-[240px] whitespace-pre-wrap break-all m-0">
                      {report().stack}
                    </pre>
                  </div>
                </Show>
              </div>

              {/* Actions — vertical stack on mobile, row on sm+ */}
              <div class="flex flex-col sm:flex-row gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={copy}
                  class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {copied() ? t("error.copied") : t("error.copyInfo")}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong border border-border-subtle transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {t("error.reset")}
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md text-sm font-medium bg-accent text-white hover:bg-accent-hover transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
                >
                  {t("error.reload")}
                </button>
              </div>
            </div>
          </div>
        );
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}

export default ErrorBoundary;
