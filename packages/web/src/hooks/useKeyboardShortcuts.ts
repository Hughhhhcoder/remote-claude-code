import { createSignal, onCleanup } from "solid-js";

/**
 * Global keyboard shortcut registry + listener (B17-A).
 *
 * Design notes:
 *   - Module-level store so registrations from any part of the tree share the
 *     same listener. `initShortcutSystem()` wires the window keydown handler
 *     exactly once.
 *   - Chord support: a registration whose `keys` is length ≥ 2 is treated as
 *     a prefix-chord. The first keypress arms a 1s window; the second key
 *     either matches (fires + clears) or is ignored (clears).
 *   - Single-key registrations fire immediately.
 *   - Modifier bindings (meta/ctrl/etc) are respected via the optional
 *     `modifiers` hint. Cmd+K lives in CommandPalette.tsx and is NOT claimed
 *     here.
 *   - Input-guard: shortcuts with `guardInput !== false` are skipped when a
 *     text input / textarea / contentEditable owns focus. `?`, `/`, and the
 *     chord prefixes set `guardInput: true` so they never eat typing.
 */

export type ShortcutCategory = "nav" | "session" | "chat" | "app";

export interface Shortcut {
  /** Stable id, e.g. "session.new". */
  id: string;
  /** Display keys, e.g. ["c", "n"] or ["?"]. Length ≥ 2 means chord. */
  keys: string[];
  /** Human-readable label shown in the help overlay. */
  label: string;
  category: ShortcutCategory;
  handler: () => void;
  /** Skip when an input/textarea/contentEditable is focused. Default true. */
  guardInput?: boolean;
  /** Required modifiers for the first (or only) key. Single-key only. */
  modifiers?: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean };
}

const [shortcutsSignal, setShortcutsSignal] = createSignal<Shortcut[]>([]);
const registry = new Map<string, Shortcut>();
let initialized = false;
let chordPrefix: string | null = null;
let chordTimer: ReturnType<typeof setTimeout> | null = null;
const CHORD_WINDOW_MS = 1000;

function publish(): void {
  setShortcutsSignal([...registry.values()]);
}

export function registerShortcut(shortcut: Shortcut): () => void {
  registry.set(shortcut.id, shortcut);
  publish();
  return () => {
    registry.delete(shortcut.id);
    publish();
  };
}

export function listShortcuts(): Shortcut[] {
  return shortcutsSignal();
}

export function useShortcuts(): { shortcuts: () => Shortcut[] } {
  return { shortcuts: shortcutsSignal };
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function normalizeKey(e: KeyboardEvent): string {
  // Prefer `e.key` lowercase; `?` remains `?`, `/` remains `/`, etc.
  const k = e.key;
  if (k.length === 1) return k.toLowerCase();
  return k;
}

function modifierMatches(e: KeyboardEvent, want: Shortcut["modifiers"]): boolean {
  if (!want) {
    // No modifier expected → reject if any non-shift modifier is held.
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    return true;
  }
  return (
    !!want.meta === e.metaKey &&
    !!want.ctrl === e.ctrlKey &&
    !!want.alt === e.altKey &&
    (want.shift === undefined ? true : !!want.shift === e.shiftKey)
  );
}

function clearChord(): void {
  chordPrefix = null;
  if (chordTimer) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }
}

function armChord(prefix: string): void {
  chordPrefix = prefix;
  if (chordTimer) clearTimeout(chordTimer);
  chordTimer = setTimeout(clearChord, CHORD_WINDOW_MS);
}

function findSingle(key: string, e: KeyboardEvent): Shortcut | null {
  for (const s of registry.values()) {
    if (s.keys.length !== 1) continue;
    if (s.keys[0]!.toLowerCase() !== key) continue;
    if (!modifierMatches(e, s.modifiers)) continue;
    return s;
  }
  return null;
}

function findChordPrefixes(key: string): Shortcut[] {
  const out: Shortcut[] = [];
  for (const s of registry.values()) {
    if (s.keys.length < 2) continue;
    if (s.keys[0]!.toLowerCase() === key) out.push(s);
  }
  return out;
}

function findChordMatch(prefix: string, key: string): Shortcut | null {
  for (const s of registry.values()) {
    if (s.keys.length < 2) continue;
    if (s.keys[0]!.toLowerCase() !== prefix) continue;
    if (s.keys[1]!.toLowerCase() !== key) continue;
    return s;
  }
  return null;
}

function handleKeydown(e: KeyboardEvent): void {
  // Never interfere with IME composition.
  if (e.isComposing) return;

  const key = normalizeKey(e);
  const activeEditable = isEditable(document.activeElement);

  // Chord follow-up phase.
  if (chordPrefix) {
    const match = findChordMatch(chordPrefix, key);
    clearChord();
    if (match) {
      if (match.guardInput !== false && activeEditable) return;
      e.preventDefault();
      match.handler();
    }
    // Non-match inside window → swallow chord, let this keypress through.
    return;
  }

  // Single-key match (e.g. "?", "/", Escape handled by consumers via registry).
  const single = findSingle(key, e);
  if (single) {
    if (single.guardInput !== false && activeEditable) return;
    e.preventDefault();
    single.handler();
    return;
  }

  // Possibly a chord prefix — only arm when no modifier is active and input
  // isn't focused (chords like `g s` should never fire while typing).
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (activeEditable) return;
  const prefixes = findChordPrefixes(key);
  if (prefixes.length > 0) {
    e.preventDefault();
    armChord(key);
  }
}

export function initShortcutSystem(): () => void {
  if (initialized) return () => {};
  initialized = true;
  window.addEventListener("keydown", handleKeydown);
  const cleanup = (): void => {
    window.removeEventListener("keydown", handleKeydown);
    clearChord();
    initialized = false;
  };
  onCleanup(cleanup);
  return cleanup;
}
