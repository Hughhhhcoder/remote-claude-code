/**
 * useHaptics — subtle vibration feedback on mobile.
 *
 * Android + modern Chromium honor `navigator.vibrate(ms | pattern)`. iOS
 * Safari / iOS PWAs currently do NOT — the call just returns false and
 * nothing happens, which is fine for us (graceful degradation).
 *
 * Returned functions:
 *   - light()    — 10ms tap (message send / workflow step done)
 *   - medium()   — 20ms (long-press action-sheet opens)
 *   - success()  — short double-pulse [12, 40, 12]
 *   - warn()     — longer double-pulse [30, 40, 30]
 *
 * Gated by `UiPrefs.haptics` (default true). Reading the pref directly from
 * localStorage (LS_KEY "rcc:ui-prefs") avoids threading PrefsStore through
 * every call site that wants a buzz. Cost: one sync JSON parse per call —
 * trivial for these low-frequency hooks.
 */

const LS_KEY = "rcc:ui-prefs";

function hapticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return true; // default true
    const parsed = JSON.parse(raw) as { haptics?: boolean };
    return parsed.haptics !== false;
  } catch {
    return true;
  }
}

function buzz(pattern: number | number[]): void {
  if (!hapticsEnabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* no-op — some browsers throw on restricted contexts */
  }
}

export interface Haptics {
  light: () => void;
  medium: () => void;
  success: () => void;
  warn: () => void;
}

export function useHaptics(): Haptics {
  return {
    light: () => buzz(10),
    medium: () => buzz(20),
    success: () => buzz([12, 40, 12]),
    warn: () => buzz([30, 40, 30]),
  };
}

/**
 * Module-level helper for non-component call sites (e.g. workflow runner,
 * toast dispatcher). Same gating as the hook.
 */
export const haptics: Haptics = {
  light: () => buzz(10),
  medium: () => buzz(20),
  success: () => buzz([12, 40, 12]),
  warn: () => buzz([30, 40, 30]),
};

export default useHaptics;
