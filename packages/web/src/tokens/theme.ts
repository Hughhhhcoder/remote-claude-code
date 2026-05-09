import { createSignal, createEffect, onCleanup } from "solid-js";

export type Theme = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

const LS_KEY = "rcc:theme";
const THEMES: readonly Theme[] = ["light", "dark", "system"] as const;

function loadInitial(): Theme {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw && (THEMES as readonly string[]).includes(raw)) return raw as Theme;
  } catch {
    // ignore (SSR / private mode)
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): EffectiveTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function apply(effective: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effective);
}

// ── module-level signals (single source of truth) ──────────────────
const [theme, setThemeInternal] = createSignal<Theme>(loadInitial());
const [effective, setEffective] = createSignal<EffectiveTheme>(resolve(theme()));

// Apply immediately on module load so there's no flash.
apply(effective());

// React to theme changes: persist + re-resolve.
createEffect(() => {
  const t = theme();
  try {
    localStorage.setItem(LS_KEY, t);
  } catch {
    // ignore
  }
  const eff = resolve(t);
  setEffective(eff);
  apply(eff);
});

// Subscribe to system preference changes when theme === "system".
if (typeof window !== "undefined" && window.matchMedia) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (theme() === "system") {
      const eff: EffectiveTheme = mql.matches ? "dark" : "light";
      setEffective(eff);
      apply(eff);
    }
  };
  if (mql.addEventListener) mql.addEventListener("change", handler);
  else mql.addListener(handler); // Safari < 14 fallback
}

/**
 * Solid-style [get, set] pair for the user's chosen theme.
 * Values: "light" | "dark" | "system".
 */
export const themeStore: [() => Theme, (t: Theme) => void] = [
  theme,
  (t: Theme) => setThemeInternal(t),
];

/**
 * Hook for components. `effective` resolves "system" to the actually-applied
 * light|dark value and updates reactively when the OS preference flips.
 */
export function useTheme(): {
  theme: () => Theme;
  setTheme: (t: Theme) => void;
  effective: () => EffectiveTheme;
} {
  return {
    theme,
    setTheme: (t: Theme) => setThemeInternal(t),
    effective,
  };
}

// Suppress "unused" when onCleanup isn't referenced — kept imported in case
// downstream tweaks need per-component listener lifecycle.
void onCleanup;
