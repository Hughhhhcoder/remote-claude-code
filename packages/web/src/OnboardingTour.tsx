import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "./i18n/index.ts";
import { useIsCompact } from "./hooks/useMediaQuery.ts";

/**
 * OnboardingTour — first-run 3-step spotlight tour.
 *
 * Mounts only when:
 *   - the `active` prop says the app should show it (caller decides this —
 *     typically "user has paired and has zero sessions"), and
 *   - the user has not previously completed or skipped the tour.
 *
 * Each step has a `target` data-attribute value (`data-tour-target="…"`) that
 * the tour looks up in the DOM. We draw a dimmed overlay with a transparent
 * cut-out rectangle over that element (SVG mask), then float a card next to
 * it. If the target can't be found (e.g. composer not mounted on a non-chat
 * view) we center the card and skip the spotlight.
 *
 * The last step ("mobileNav") is only added on compact viewports.
 *
 * Persistence: a "completed" flag is written to localStorage so the tour only
 * runs once per browser profile.
 */

const STORAGE_KEY = "rcc.onboardingTour.completed";

interface Step {
  key: "newSession" | "composer" | "mobileNav";
  target: string | null; // null = no spotlight, center card
  titleKey: Parameters<typeof t>[0];
  bodyKey: Parameters<typeof t>[0];
}

function hasCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore storage failures — worst case tour shows again next time
  }
}

export interface OnboardingTourProps {
  /** Caller gates mount (e.g. sessions.length === 0 && paired). */
  active: boolean;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function OnboardingTour(props: OnboardingTourProps) {
  const isCompact = useIsCompact();
  const [completed, setCompleted] = createSignal(hasCompleted());
  const [stepIdx, setStepIdx] = createSignal(0);
  const [rect, setRect] = createSignal<Rect | null>(null);

  const steps = createMemo<Step[]>(() => {
    const base: Step[] = [
      {
        key: "newSession",
        target: "new-session",
        titleKey: "tour.newSession.title",
        bodyKey: "tour.newSession.body",
      },
      {
        key: "composer",
        target: "composer",
        titleKey: "tour.composer.title",
        bodyKey: "tour.composer.body",
      },
    ];
    if (isCompact()) {
      base.push({
        key: "mobileNav",
        target: null,
        titleKey: "tour.mobileNav.title",
        bodyKey: "tour.mobileNav.body",
      });
    }
    return base;
  });

  const show = createMemo(() => props.active && !completed());
  const currentStep = createMemo(() => steps()[stepIdx()] ?? steps()[0]);

  function measure() {
    const step = currentStep();
    if (!step || !step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(
      `[data-tour-target="${step.target}"]`,
    );
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }

  createEffect(() => {
    // Re-measure on step change, active change, compact change.
    void stepIdx();
    void show();
    void isCompact();
    if (!show()) return;
    // Defer so the DOM has settled (e.g. if a modal just closed).
    queueMicrotask(measure);
  });

  onMount(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    });
  });

  function next() {
    const idx = stepIdx();
    if (idx >= steps().length - 1) {
      finish();
    } else {
      setStepIdx(idx + 1);
    }
  }

  function finish() {
    markCompleted();
    setCompleted(true);
  }

  function skip() {
    finish();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      skip();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      next();
    }
  }

  // Card positioning: on mobile, always bottom-center so it doesn't overlap
  // the spotlight. On desktop, float next to the target if we have a rect.
  const cardStyle = createMemo<Record<string, string>>(() => {
    if (isCompact()) {
      const s: Record<string, string> = {
        bottom: "max(16px, env(safe-area-inset-bottom))",
        left: "16px",
        right: "16px",
      };
      return s;
    }
    const r = rect();
    if (!r) {
      const s: Record<string, string> = {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
      return s;
    }
    const cardW = 340;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer placing to the right of target; fall back to left or below.
    const rightX = r.left + r.width + margin;
    if (rightX + cardW + margin <= vw) {
      const s: Record<string, string> = {
        top: `${Math.max(margin, Math.min(r.top, vh - 240))}px`,
        left: `${rightX}px`,
      };
      return s;
    }
    const leftX = r.left - cardW - margin;
    if (leftX >= margin) {
      const s: Record<string, string> = {
        top: `${Math.max(margin, Math.min(r.top, vh - 240))}px`,
        left: `${leftX}px`,
      };
      return s;
    }
    // Place below the target, clamped to viewport.
    const belowY = r.top + r.height + margin;
    const s: Record<string, string> = {
      top: `${Math.min(belowY, vh - 240)}px`,
      left: `${Math.max(margin, Math.min(r.left, vw - cardW - margin))}px`,
    };
    return s;
  });

  const spotlightPadding = 8;

  return (
    <Show when={show()}>
      <Portal>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("tour.aria")}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          class="fixed inset-0 z-[60] pointer-events-auto"
          style={{ "animation": "rccFadeIn 180ms ease-out" }}
        >
          {/* Dim overlay with optional cut-out via SVG mask. */}
          <Show
            when={rect()}
            fallback={
              <div
                class="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={skip}
              />
            }
          >
            {(r) => {
              const cutout = () => ({
                x: Math.max(0, r().left - spotlightPadding),
                y: Math.max(0, r().top - spotlightPadding),
                w: r().width + spotlightPadding * 2,
                h: r().height + spotlightPadding * 2,
              });
              return (
                <svg
                  class="absolute inset-0 w-full h-full"
                  onClick={skip}
                  aria-hidden="true"
                >
                  <defs>
                    <mask id="rcc-tour-mask">
                      <rect
                        x="0"
                        y="0"
                        width="100%"
                        height="100%"
                        fill="white"
                      />
                      <rect
                        x={cutout().x}
                        y={cutout().y}
                        width={cutout().w}
                        height={cutout().h}
                        rx="12"
                        ry="12"
                        fill="black"
                      />
                    </mask>
                  </defs>
                  <rect
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    fill="rgba(0,0,0,0.62)"
                    mask="url(#rcc-tour-mask)"
                  />
                  {/* Highlight ring */}
                  <rect
                    x={cutout().x}
                    y={cutout().y}
                    width={cutout().w}
                    height={cutout().h}
                    rx="12"
                    ry="12"
                    fill="none"
                    stroke="var(--color-accent, #c96442)"
                    stroke-width="2"
                    style={{ "pointer-events": "none" }}
                  />
                </svg>
              );
            }}
          </Show>

          {/* Skip button, always top-right. */}
          <button
            type="button"
            onClick={skip}
            class={
              "absolute top-4 right-4 font-sans text-sm px-3 h-9 rounded-md " +
              "bg-bg-surface text-text-primary border border-border-subtle " +
              "hover:border-border-strong transition " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            }
            style={{ "padding-top": "env(safe-area-inset-top, 0px)" }}
          >
            {t("tour.skip")}
          </button>

          {/* Card */}
          <div
            class={
              "absolute w-[min(340px,calc(100vw-32px))] " +
              "bg-bg-surface text-text-primary border border-border-subtle " +
              "rounded-xl shadow-2xl p-5 flex flex-col gap-3"
            }
            style={cardStyle()}
          >
            <div class="flex items-center justify-between gap-2">
              <div class="font-sans text-xs text-text-secondary">
                {stepIdx() + 1} / {steps().length}
              </div>
              <div class="flex gap-1" aria-hidden="true">
                {steps().map((_, i) => (
                  <span
                    class={
                      "inline-block w-1.5 h-1.5 rounded-full " +
                      (i === stepIdx()
                        ? "bg-accent"
                        : "bg-border-strong/60")
                    }
                  />
                ))}
              </div>
            </div>
            <h2 class="font-serif text-lg font-medium text-text-primary m-0">
              {t(currentStep().titleKey)}
            </h2>
            <p class="font-sans text-sm text-text-secondary m-0 leading-relaxed">
              {t(currentStep().bodyKey)}
            </p>
            <div class="flex items-center justify-between gap-2 mt-1">
              <button
                type="button"
                onClick={skip}
                class={
                  "font-sans text-sm text-text-secondary hover:text-text-primary " +
                  "transition focus-visible:outline-none focus-visible:ring-2 " +
                  "focus-visible:ring-accent rounded px-1"
                }
              >
                {t("tour.skipInline")}
              </button>
              <button
                type="button"
                onClick={next}
                class={
                  "inline-flex items-center justify-center h-10 px-4 rounded-md " +
                  "font-sans font-medium text-sm " +
                  "bg-accent text-white hover:bg-accent-hover transition " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
                }
              >
                {stepIdx() >= steps().length - 1
                  ? t("tour.done")
                  : t("tour.next")}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
