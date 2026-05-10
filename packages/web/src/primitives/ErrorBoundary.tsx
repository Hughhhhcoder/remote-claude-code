import { ErrorBoundary as SolidErrorBoundary, createSignal, Show, type JSX } from "solid-js";

/**
 * ErrorBoundary — wraps Solid's built-in <ErrorBoundary> with a polished
 * crash page: friendly copy, collapsible stack, retry + copy-report + GH
 * issues actions. Use nested (e.g. scope="app" outside, scope="chat" around
 * the chat tree) so one pane crashing doesn't tear down the whole shell.
 *
 * Semantic tokens only — the crash page must look correct in both light
 * and dark themes via the `data-theme` attribute on <html>.
 */

const RCC_VERSION = "v0.2-dev";
const GH_ISSUES_URL = "https://github.com/Hughhhhcoder/remote-claude-code/issues/new";

export interface ErrorBoundaryProps {
  children: JSX.Element;
  /** Optional section label surfaced on the crash page (e.g. "对话" / "设置"). */
  scope?: string;
  /** Called with the raw error when a child throws. */
  onError?: (err: unknown) => void;
}

function buildReport(err: unknown, scope: string | undefined): string {
  const e = err as { name?: string; message?: string; stack?: string } | null;
  return JSON.stringify(
    {
      scope: scope ?? "global",
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
      url: typeof location !== "undefined" ? location.href : "n/a",
      viewport:
        typeof window !== "undefined"
          ? { w: window.innerWidth, h: window.innerHeight }
          : { w: 0, h: 0 },
      rcc: { version: RCC_VERSION },
      error: {
        name: e?.name ?? "UnknownError",
        message: e?.message ?? String(err),
        stack: e?.stack ?? "(no stack)",
      },
    },
    null,
    2,
  );
}

export function ErrorBoundary(props: ErrorBoundaryProps): JSX.Element {
  return (
    <SolidErrorBoundary
      fallback={(err, reset) => {
        // Side-effect: surface to onError handler, once per mount of the fallback.
        try {
          props.onError?.(err);
        } catch {
          // swallow — callback errors must not cascade
        }
        const [copied, setCopied] = createSignal(false);
        const report = () => buildReport(err, props.scope);

        async function copy() {
          const text = report();
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(text);
            } else {
              // Fallback for non-secure contexts.
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
            // ignore — clipboard perms may be denied
          }
        }

        const stack = () =>
          (err as { stack?: string } | null)?.stack ??
          (err as { message?: string } | null)?.message ??
          String(err);

        return (
          <div
            role="alert"
            class="min-h-full w-full flex items-center justify-center bg-bg-page text-text-primary p-4"
          >
            <div class="mx-4 w-full max-w-[640px] rounded-lg border border-border-subtle bg-bg-surface shadow-sm p-6 flex flex-col gap-4">
              <div class="flex flex-col items-center gap-3 text-center">
                <div class="text-danger text-5xl leading-none" aria-hidden="true">
                  ⚠
                </div>
                <h1
                  class="font-serif text-[20px] font-medium"
                  style={{ "font-family": "var(--font-serif)" }}
                >
                  出了点问题
                </h1>
                <p class="text-sm text-text-secondary">
                  页面可能没有完全崩溃 — 可以点击"重试",或把错误报告发给开发者
                  <Show when={props.scope}>
                    <span class="ml-1 text-text-muted">· {props.scope}</span>
                  </Show>
                </p>
              </div>

              <details class="group">
                <summary class="cursor-pointer select-none text-[13px] text-text-secondary hover:text-text-primary min-h-[32px] inline-flex items-center">
                  显示详情
                </summary>
                <pre class="mt-2 text-[12px] font-mono bg-codeBg rounded-md p-3 overflow-auto max-h-[240px] whitespace-pre-wrap break-all text-danger">
                  {stack()}
                </pre>
              </details>

              <div class="flex flex-wrap gap-2 justify-end pt-2">
                <a
                  href={GH_ISSUES_URL}
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong transition"
                >
                  报告到 GitHub
                </a>
                <button
                  type="button"
                  onClick={copy}
                  class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong transition"
                >
                  {copied() ? "✓ 已复制" : "复制报告"}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md text-sm font-medium bg-accent text-white hover:bg-accent-hover transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
                >
                  重试
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
