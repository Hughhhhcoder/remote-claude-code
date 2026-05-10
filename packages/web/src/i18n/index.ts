import { createSignal } from "solid-js";
import { zh } from "./zh.ts";
import { en } from "./en.ts";

type Dict = Record<keyof typeof zh, string>;
const dicts: Record<string, Dict> = { zh, en };

const STORAGE_KEY = "rcc.locale";

const initialLocale = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in dicts) return stored;
  } catch {
    // localStorage may throw in some sandboxes; fall through to navigator
  }
  try {
    return navigator.language.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
})();

const [locale, setLocaleSig] = createSignal(initialLocale);

export function t(key: keyof Dict): string {
  const d = dicts[locale()];
  return (d && d[key]) ?? dicts.en[key] ?? (key as string);
}

/**
 * Template variant of {@link t}. Looks up the key, then substitutes `{name}`
 * placeholders with values from `vars`. Unknown placeholders are left as-is,
 * so typos are visible rather than blank.
 */
export function tt(key: keyof Dict, vars: Record<string, string | number>): string {
  const raw = t(key);
  return raw.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function setLocale(lang: string) {
  if (!(lang in dicts)) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore storage failure; in-memory locale still updates
  }
  setLocaleSig(lang);
}

export function getLocale(): string {
  return locale();
}

export function availableLocales(): string[] {
  return Object.keys(dicts);
}
