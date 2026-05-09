import { createSignal } from "solid-js";
import type { UiPrefs, UiPrefsPartial, UiAccent } from "@rcc/protocol";
import { UiPrefs as UiPrefsSchema } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

const LS_KEY = "rcc:ui-prefs";

const DEFAULTS: UiPrefs = UiPrefsSchema.parse({});

const ESC = "";
const CTRL_C = "";

/** RGB triplets for accent CSS vars. Tailwind colors 300/400/500/600. */
const ACCENT_RGB: Record<UiAccent, { 300: string; 400: string; 500: string; 600: string }> = {
  orange: { 300: "253 186 116", 400: "251 146 60", 500: "249 115 22", 600: "234 88 12" },
  cyan: { 300: "103 232 249", 400: "34 211 238", 500: "6 182 212", 600: "8 145 178" },
  violet: { 300: "196 181 253", 400: "167 139 250", 500: "139 92 246", 600: "124 58 237" },
  pink: { 300: "249 168 212", 400: "244 114 182", 500: "236 72 153", 600: "219 39 119" },
  emerald: { 300: "110 231 183", 400: "52 211 153", 500: "16 185 129", 600: "5 150 105" },
};

function loadFromStorage(): UiPrefs | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = UiPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveToStorage(p: UiPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    // ignore quota
  }
}

/**
 * Apply prefs to the DOM:
 *  - `--accent-{300,400,500,600}` CSS vars for the accent color scale
 *  - html font-size drives rem-based sizing and scales tailwind's text-[Npx]
 *  - `data-theme` attribute (reserved; full light mode is a later step)
 */
export function applyPrefs(p: UiPrefs): void {
  const root = document.documentElement;
  const rgb = ACCENT_RGB[p.accent];
  root.style.setProperty("--accent-300", rgb[300]);
  root.style.setProperty("--accent-400", rgb[400]);
  root.style.setProperty("--accent-500", rgb[500]);
  root.style.setProperty("--accent-600", rgb[600]);
  root.style.fontSize = `${16 * p.fontScale}px`;
  const resolved =
    p.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : p.theme;
  root.setAttribute("data-theme", resolved);
}

export interface PrefsStore {
  prefs: () => UiPrefs;
  update: (patch: UiPrefsPartial) => void;
  dispose: () => void;
}

export function createPrefsStore(client: RccClient): PrefsStore {
  const initial = loadFromStorage() ?? DEFAULTS;
  applyPrefs(initial);
  const [prefs, setPrefs] = createSignal<UiPrefs>(initial);

  client.send({ v: 1, t: "prefs.request" });

  const unsub = client.on((frame) => {
    if (frame.t === "prefs") {
      setPrefs(frame.prefs);
      saveToStorage(frame.prefs);
      applyPrefs(frame.prefs);
    }
  });

  function update(patch: UiPrefsPartial): void {
    const next: UiPrefs = {
      ...prefs(),
      ...patch,
      customKeys: patch.customKeys ?? prefs().customKeys,
    };
    setPrefs(next);
    saveToStorage(next);
    applyPrefs(next);
    client.send({ v: 1, t: "prefs.update", prefs: patch });
  }

  return {
    prefs,
    update,
    dispose: unsub,
  };
}

export const DEFAULT_CUSTOM_KEYS: readonly { label: string; send: string; hint?: string }[] = [
  { label: "Esc", send: ESC },
  { label: "Tab", send: "\t" },
  { label: "↑", send: `${ESC}[A` },
  { label: "↓", send: `${ESC}[B` },
  { label: "Enter", send: "\r" },
  { label: "/", send: "/" },
  { label: "^C", send: CTRL_C },
  { label: "⇧Tab", send: `${ESC}[Z`, hint: "plan mode toggle" },
];

/**
 * Decode a user-entered send string. Supports `\xNN` / `\uNNNN` / `\n` / `\r`
 * / `\t` / `\\`. Keeps the raw char for anything else. Output capped at 64
 * chars so a pathological escape sequence can't balloon.
 */
export function decodeSendEscapes(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length && out.length < 64) {
    const ch = input[i]!;
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }
    const next = input[i + 1];
    if (next === "x" && i + 3 < input.length) {
      const hex = input.slice(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
    }
    if (next === "u" && i + 5 < input.length) {
      const hex = input.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
    }
    if (next === "n") {
      out += "\n";
      i += 2;
      continue;
    }
    if (next === "r") {
      out += "\r";
      i += 2;
      continue;
    }
    if (next === "t") {
      out += "\t";
      i += 2;
      continue;
    }
    if (next === "\\") {
      out += "\\";
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Inverse of decodeSendEscapes for display in an input field. */
export function encodeSendEscapes(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += "\\x" + code.toString(16).padStart(2, "0");
    } else {
      out += ch;
    }
  }
  return out;
}
