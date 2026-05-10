import { For, Show, createSignal } from "solid-js";
import type { UiAccent, UiCustomKey, UiPrefs } from "@rcc/protocol";
import { UI_ACCENT_COLORS } from "@rcc/protocol";
import { DEFAULT_CUSTOM_KEYS, decodeSendEscapes, encodeSendEscapes, type PrefsStore } from "./prefs.ts";
import { availableLocales, getLocale, setLocale, t } from "./i18n/index.ts";
import { useTheme } from "./tokens/theme.ts";
import { Toggle } from "./primitives/Toggle.tsx";
import type { RccClient } from "./client.ts";
import {
  defaultQuietHours,
  getQuietHours,
  pushQuietHours,
  setQuietHoursLocal,
} from "./push.ts";

type Props = {
  open: boolean;
  store: PrefsStore;
  client: RccClient;
  onClose: () => void;
};

const ACCENT_SWATCH: Record<UiAccent, string> = {
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
  emerald: "bg-emerald-500",
};

const LOCALE_LABELS: Record<string, string> = {
  zh: "简体中文",
  en: "English",
};

export function SettingsModal(props: Props) {
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-3"
        onClick={props.onClose}
      >
        <div
          class="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-900 sticky top-0 bg-zinc-950">
            <div class="flex items-center gap-2 text-sm font-medium">
              <span>🎨</span>
              <span>{t("settings.title")}</span>
            </div>
            <button
              class="text-zinc-500 hover:text-zinc-200 text-sm"
              onClick={props.onClose}
              title={t("settings.close")}
            >
              ✕
            </button>
          </div>

          <div class="p-5 space-y-6">
            <LanguageSection />
            <AppearanceSection />
            <AccentSection store={props.store} />
            <FontScaleSection store={props.store} />
            <QuietHoursSection client={props.client} />
            <KeysSection store={props.store} />
          </div>

          <div class="px-5 py-3 border-t border-zinc-900 flex items-center justify-between text-[11px] text-zinc-600">
            <div>{t("settings.footer")}</div>
            <button
              class="px-2.5 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700"
              onClick={() => props.store.update({ customKeys: [...DEFAULT_CUSTOM_KEYS] })}
              title={t("settings.resetKeysTitle")}
            >
              {t("settings.resetKeys")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

function LanguageSection() {
  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
        {t("settings.language")}
      </div>
      <select
        value={getLocale()}
        onChange={(e) => setLocale(e.currentTarget.value)}
        class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
      >
        <For each={availableLocales()}>
          {(code) => <option value={code}>{LOCALE_LABELS[code] ?? code}</option>}
        </For>
      </select>
    </section>
  );
}

function AppearanceSection() {
  const { highContrast, setHighContrast } = useTheme();
  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
        {t("settings.appearance")}
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm text-zinc-200">{t("settings.highContrast")}</div>
          <div class="text-[11px] text-zinc-500">{t("settings.highContrastHint")}</div>
        </div>
        <Toggle
          checked={highContrast()}
          onChange={setHighContrast}
          aria-label={t("settings.highContrast")}
        />
      </div>
    </section>
  );
}

function AccentSection(props: { store: PrefsStore }) {
  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">{t("settings.accent")}</div>
      <div class="flex items-center gap-2 flex-wrap">
        <For each={UI_ACCENT_COLORS}>
          {(c) => {
            const selected = () => props.store.prefs().accent === c;
            return (
              <button
                class={`w-8 h-8 rounded-full grid place-items-center transition ${
                  ACCENT_SWATCH[c]
                } ${selected() ? "ring-2 ring-offset-2 ring-offset-zinc-950 ring-white" : "opacity-80 hover:opacity-100"}`}
                onClick={() => props.store.update({ accent: c })}
                title={c}
              >
                <Show when={selected()}>
                  <span class="text-white text-xs">✓</span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </section>
  );
}

function FontScaleSection(props: { store: PrefsStore }) {
  return (
    <section>
      <div class="flex items-center justify-between mb-2">
        <div class="text-[10px] uppercase tracking-widest text-zinc-500">{t("settings.fontScale")}</div>
        <div class="text-xs text-zinc-400 font-mono">{props.store.prefs().fontScale.toFixed(2)}×</div>
      </div>
      <input
        type="range"
        min="0.8"
        max="1.4"
        step="0.05"
        value={props.store.prefs().fontScale}
        onInput={(e) =>
          props.store.update({ fontScale: parseFloat(e.currentTarget.value) || 1 })
        }
        class="w-full accent-accent-500"
      />
      <div class="flex items-center justify-between text-[10px] text-zinc-600 mt-1">
        <span>0.8×</span>
        <button
          class="text-zinc-500 hover:text-zinc-200"
          onClick={() => props.store.update({ fontScale: 1.0 })}
        >
          {t("settings.reset")}
        </button>
        <span>1.4×</span>
      </div>
    </section>
  );
}

function KeysSection(props: { store: PrefsStore }) {
  const keys = () => {
    const k = props.store.prefs().customKeys;
    return k.length > 0 ? k : [...DEFAULT_CUSTOM_KEYS];
  };

  function replaceAt(idx: number, patch: Partial<UiCustomKey>) {
    const current = keys().slice();
    const existing = current[idx];
    if (!existing) return;
    const next: UiCustomKey = {
      label: patch.label ?? existing.label,
      send: patch.send ?? existing.send,
      hint: patch.hint ?? existing.hint,
    };
    current[idx] = next;
    props.store.update({ customKeys: current });
  }

  function removeAt(idx: number) {
    const current = keys().slice();
    current.splice(idx, 1);
    props.store.update({ customKeys: current });
  }

  function add() {
    const current = keys().slice();
    if (current.length >= 32) return;
    current.push({ label: "New", send: "" });
    props.store.update({ customKeys: current });
  }

  return (
    <section>
      <div class="flex items-center justify-between mb-2">
        <div class="text-[10px] uppercase tracking-widest text-zinc-500">{t("settings.keys")}</div>
        <button
          class="text-[11px] px-2 py-0.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700"
          onClick={add}
          disabled={keys().length >= 32}
        >
          {t("settings.addKey")}
        </button>
      </div>
      <div class="space-y-1.5">
        <div class="grid grid-cols-[80px_1fr_1fr_28px] gap-2 text-[10px] text-zinc-600 px-1">
          <div>label</div>
          <div>send (支持 \x1b \r \t \\)</div>
          <div>hint</div>
          <div></div>
        </div>
        <Show
          when={keys().length > 0}
          fallback={<div class="text-[11px] text-zinc-600 px-1 py-2">{t("settings.noKeys")}</div>}
        >
          <For each={keys()}>
            {(k, i) => (
              <KeyRow
                k={k}
                onLabel={(v) => replaceAt(i(), { label: v })}
                onSend={(v) => replaceAt(i(), { send: v })}
                onHint={(v) => replaceAt(i(), { hint: v })}
                onRemove={() => removeAt(i())}
              />
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}

function QuietHoursSection(props: { client: RccClient }) {
  const initial = getQuietHours() ?? defaultQuietHours();
  const [enabled, setEnabled] = createSignal(initial.enabled);
  const [startH, setStartH] = createSignal(initial.startHour);
  const [endH, setEndH] = createSignal(initial.endHour);
  const tz = initial.timezone;

  function persistAndPush() {
    const qh = {
      enabled: enabled(),
      startHour: startH(),
      endHour: endH(),
      timezone: tz,
    };
    setQuietHoursLocal(qh);
    pushQuietHours(props.client, qh.enabled ? qh : null);
  }

  function parseHour(v: string, fallback: number): number {
    // "HH:MM" — we only keep hour precision for the host window.
    const m = /^(\d{1,2})/.exec(v);
    if (!m) return fallback;
    const h = parseInt(m[1]!, 10);
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h : fallback;
  }

  function fmt(h: number): string {
    return `${String(h).padStart(2, "0")}:00`;
  }

  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">静音时段</div>
      <div class="flex items-center justify-between gap-3 mb-2">
        <div class="min-w-0">
          <div class="text-sm text-zinc-200">启用静音时段</div>
          <div class="text-[11px] text-zinc-500">
            静音时段内仍会收到严重告警(主机崩溃、认证失败)
          </div>
        </div>
        <Toggle
          checked={enabled()}
          onChange={(v) => {
            setEnabled(v);
            persistAndPush();
          }}
          aria-label="启用静音时段"
        />
      </div>
      <div class="flex items-center gap-2 text-xs text-zinc-400">
        <label class="flex items-center gap-1.5">
          开始
          <input
            type="time"
            step="3600"
            value={fmt(startH())}
            onChange={(e) => {
              setStartH(parseHour(e.currentTarget.value, startH()));
              persistAndPush();
            }}
            class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 font-mono focus:outline-none focus:border-accent-500"
          />
        </label>
        <span class="text-zinc-600">→</span>
        <label class="flex items-center gap-1.5">
          结束
          <input
            type="time"
            step="3600"
            value={fmt(endH())}
            onChange={(e) => {
              setEndH(parseHour(e.currentTarget.value, endH()));
              persistAndPush();
            }}
            class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 font-mono focus:outline-none focus:border-accent-500"
          />
        </label>
        <span class="ml-auto text-[10px] text-zinc-600 truncate" title={tz}>
          {tz}
        </span>
      </div>
    </section>
  );
}

function KeyRow(props: {
  k: UiCustomKey;
  onLabel: (v: string) => void;
  onSend: (v: string) => void;
  onHint: (v: string) => void;
  onRemove: () => void;
}) {
  const [sendDraft, setSendDraft] = createSignal(encodeSendEscapes(props.k.send));

  function commitSend() {
    const decoded = decodeSendEscapes(sendDraft());
    if (decoded.length > 64) return;
    if (decoded === props.k.send) return;
    props.onSend(decoded);
  }

  return (
    <div class="grid grid-cols-[80px_1fr_1fr_28px] gap-2 items-center">
      <input
        value={props.k.label}
        onInput={(e) => props.onLabel(e.currentTarget.value.slice(0, 32))}
        class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-accent-500"
      />
      <input
        value={sendDraft()}
        onInput={(e) => setSendDraft(e.currentTarget.value)}
        onBlur={commitSend}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitSend();
        }}
        class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-accent-500"
        placeholder="\x1b[A"
      />
      <input
        value={props.k.hint ?? ""}
        onInput={(e) => props.onHint(e.currentTarget.value.slice(0, 120))}
        class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-400 focus:outline-none focus:border-accent-500"
        placeholder="optional"
      />
      <button
        class="text-zinc-600 hover:text-rose-400 text-sm"
        onClick={props.onRemove}
        title={t("settings.remove")}
      >
        ✕
      </button>
    </div>
  );
}
