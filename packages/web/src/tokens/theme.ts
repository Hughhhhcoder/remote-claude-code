import { createSignal, createEffect, onCleanup } from "solid-js";

export type Theme = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

const LS_KEY = "rcc:theme";
const LS_CONTRAST_KEY = "rcc.theme.contrast";
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

function systemPrefersMoreContrast(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-contrast: more)").matches;
}

function loadInitialContrast(): boolean {
  try {
    const raw = localStorage.getItem(LS_CONTRAST_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  // No explicit user preference — fall back to the OS hint.
  return systemPrefersMoreContrast();
}

function resolve(theme: Theme): EffectiveTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function apply(effective: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effective);
}

function applyContrast(high: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    "data-theme-contrast",
    high ? "high" : "normal"
  );
}

// ── module-level signals (single source of truth) ──────────────────
const [theme, setThemeInternal] = createSignal<Theme>(loadInitial());
const [effective, setEffective] = createSignal<EffectiveTheme>(resolve(theme()));
const [highContrast, setHighContrastInternal] =
  createSignal<boolean>(loadInitialContrast());

// Apply immediately on module load so there's no flash.
apply(effective());
applyContrast(highContrast());

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

// React to high-contrast changes: persist + apply attribute.
createEffect(() => {
  const hc = highContrast();
  try {
    localStorage.setItem(LS_CONTRAST_KEY, hc ? "1" : "0");
  } catch {
    // ignore
  }
  applyContrast(hc);
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

  // Track prefers-contrast: more — only auto-follows while the user has
  // NOT set an explicit choice (no LS entry).
  const cql = window.matchMedia("(prefers-contrast: more)");
  const cHandler = () => {
    let explicit = false;
    try {
      const raw = localStorage.getItem(LS_CONTRAST_KEY);
      explicit = raw === "0" || raw === "1";
    } catch {
      // ignore
    }
    if (!explicit) setHighContrastInternal(cql.matches);
  };
  if (cql.addEventListener) cql.addEventListener("change", cHandler);
  else if (cql.addListener) cql.addListener(cHandler);
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
  highContrast: () => boolean;
  setHighContrast: (v: boolean) => void;
} {
  return {
    theme,
    setTheme: (t: Theme) => setThemeInternal(t),
    effective,
    highContrast,
    setHighContrast: (v: boolean) => setHighContrastInternal(v),
  };
}

// Suppress "unused" when onCleanup isn't referenced — kept imported in case
// downstream tweaks need per-component listener lifecycle.
void onCleanup;
