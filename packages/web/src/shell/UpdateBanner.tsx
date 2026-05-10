import { Show, type JSX } from "solid-js";
import { useUpdateWaiting, applyUpdate, dismissUpdate } from "../sw-registration";

/**
 * UpdateBanner — shows when a new Service Worker is installed and waiting.
 *
 * Rendered at the root of App (inside the authed branch). Non-blocking strip
 * at the bottom of the viewport; user clicks "立即更新" to apply, "稍后" to
 * dismiss for the session. On mobile the buttons stack; touch targets ≥ 44px.
 */

export function UpdateBanner(): JSX.Element {
  const waiting = useUpdateWaiting();
  return (
    <Show when={waiting()}>
      <div
        role="status"
        aria-live="polite"
        class={
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 " +
          "flex flex-col sm:flex-row items-stretch sm:items-center gap-2 " +
          "px-4 py-3 rounded-lg shadow-lg " +
          "bg-accent text-bg-page " +
          "max-w-[calc(100vw-32px)] sm:max-w-md w-full"
        }
      >
        <span class="flex-1 text-sm font-sans">有新版本可用</span>
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => applyUpdate()}
            class={
              "min-h-[36px] sm:min-h-[32px] px-3 rounded-md " +
              "bg-bg-page text-accent font-medium text-sm " +
              "hover:bg-bg-surface transition " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bg-page " +
              "focus-visible:ring-offset-2 focus-visible:ring-offset-accent"
            }
          >
            立即更新
          </button>
          <button
            type="button"
            onClick={() => dismissUpdate()}
            class={
              "min-h-[36px] sm:min-h-[32px] px-3 rounded-md " +
              "bg-transparent text-bg-page/85 text-sm " +
              "hover:bg-bg-page/10 transition " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bg-page " +
              "focus-visible:ring-offset-2 focus-visible:ring-offset-accent"
            }
            aria-label="稍后更新"
          >
            稍后
          </button>
        </div>
      </div>
    </Show>
  );
}
