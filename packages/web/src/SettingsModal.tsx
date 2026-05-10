import { For, Show, createSignal } from "solid-js";
import type { UiAccent, UiCustomKey, UiPrefs } from "@rcc/protocol";
import { UI_ACCENT_COLORS } from "@rcc/protocol";
import { DEFAULT_CUSTOM_KEYS, decodeSendEscapes, encodeSendEscapes, type PrefsStore } from "./prefs.ts";
import { availableLocales, getLocale, setLocale, t } from "./i18n/index.ts";
import { useTheme } from "./tokens/theme.ts";
import { Toggle } from "./primitives/Toggle.tsx";
import type { RccClient } from "./client.ts";
import { loadToken } from "./auth.ts";
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
  // [B31-B] Open the bug-report modal. Optional so tests / other call sites
  // that don't wire this up (there are none today, but be defensive) still
  // compile; when omitted, the entry is hidden.
  onOpenBugReport?: () => void;
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

// [B29-C] Common escape-sequence presets for the "+ 添加按键" picker. These
// are the sequences we expect most users to want on the mobile key bar; the
// raw `send` strings use real control bytes so decodeSendEscapes is not needed.
const ESC_CHAR = "\x1b";
const KEY_PRESETS: ReadonlyArray<UiCustomKey & { group: string }> = [
  // Navigation
  { group: "nav", label: "↑", send: `${ESC_CHAR}[A`, hint: "history / up" },
  { group: "nav", label: "↓", send: `${ESC_CHAR}[B`, hint: "history / down" },
  { group: "nav", label: "←", send: `${ESC_CHAR}[D` },
  { group: "nav", label: "→", send: `${ESC_CHAR}[C` },
  { group: "nav", label: "Home", send: `${ESC_CHAR}[H` },
  { group: "nav", label: "End", send: `${ESC_CHAR}[F` },
  { group: "nav", label: "PgUp", send: `${ESC_CHAR}[5~` },
  { group: "nav", label: "PgDn", send: `${ESC_CHAR}[6~` },
  // Editing
  { group: "edit", label: "Esc", send: ESC_CHAR },
  { group: "edit", label: "Tab", send: "\t" },
  { group: "edit", label: "⇧Tab", send: `${ESC_CHAR}[Z`, hint: "plan mode toggle" },
  { group: "edit", label: "Enter", send: "\r" },
  { group: "edit", label: "Del", send: `${ESC_CHAR}[3~` },
  // Control
  { group: "ctrl", label: "^C", send: "\x03", hint: "interrupt" },
  { group: "ctrl", label: "^D", send: "\x04", hint: "eof / exit" },
  { group: "ctrl", label: "^L", send: "\x0c", hint: "clear" },
  { group: "ctrl", label: "^Z", send: "\x1a", hint: "suspend" },
  { group: "ctrl", label: "^R", send: "\x12", hint: "reverse search" },
  // Slash commands / prefixes
  { group: "char", label: "/", send: "/" },
  { group: "char", label: "!", send: "!" },
  { group: "char", label: "?", send: "?" },
  { group: "char", label: "@", send: "@" },
  { group: "char", label: "#", send: "#" },
];

const PRESET_GROUP_LABELS: Record<string, string> = {
  nav: "方向与翻页",
  edit: "编辑",
  ctrl: "控制序列",
  char: "字符 / 前缀",
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
            <ShowThinkingSection store={props.store} />
            <HapticsSection store={props.store} />
            <AccentSection store={props.store} />
            <FontScaleSection store={props.store} />
            <QuietHoursSection client={props.client} />
            <KeysSection store={props.store} />
            <LogsExportSection />
            <Show when={props.onOpenBugReport}>
              <AboutSection
                onOpenBugReport={() => {
                  props.onOpenBugReport?.();
                  props.onClose();
                }}
              />
            </Show>
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

/**
 * [B27-B] Toggle whether Claude's extended-thinking segments auto-expand on
 * mount. Default off — users see a collapsed chip and click to reveal. When
 * on, every newly rendered thinking block mounts expanded.
 */
function ShowThinkingSection(props: { store: PrefsStore }) {
  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
        思考片段
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm text-zinc-200">总是展开思考</div>
          <div class="text-[11px] text-zinc-500">
            关闭时,思考片段以 💭 小芯片形式折叠;点击展开查看内容。
          </div>
        </div>
        <Toggle
          checked={props.store.prefs().showThinking === true}
          onChange={(v) => props.store.update({ showThinking: v })}
          aria-label="总是展开思考"
        />
      </div>
    </section>
  );
}

/**
 * [B29-B] Subtle haptic feedback on key interactions (message send, approval
 * approve/deny, long-press action-sheet). Uses navigator.vibrate() — no-op on
 * iOS Safari / older browsers, so this switch primarily controls Android and
 * modern Chromium. Default on.
 */
function HapticsSection(props: { store: PrefsStore }) {
  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
        触感反馈
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm text-zinc-200">启用震动反馈</div>
          <div class="text-[11px] text-zinc-500">
            发送消息、批准/拒绝、长按菜单时轻微震动。iOS Safari 不支持此 API,开关无效。
          </div>
        </div>
        <Toggle
          checked={props.store.prefs().haptics !== false}
          onChange={(v) => props.store.update({ haptics: v })}
          aria-label="启用震动反馈"
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

  // [B29-C] Preset picker: when non-null the panel is open and the user
  // can click a preset to append it to the custom key list.
  const [pickerOpen, setPickerOpen] = createSignal(false);

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

  // [B29-C] Swap item at idx with idx+dir. Clamped at list edges (no-op).
  function moveAt(idx: number, dir: -1 | 1) {
    const current = keys().slice();
    const target = idx + dir;
    if (target < 0 || target >= current.length) return;
    const a = current[idx];
    const b = current[target];
    if (!a || !b) return;
    current[idx] = b;
    current[target] = a;
    props.store.update({ customKeys: current });
  }

  function add() {
    const current = keys().slice();
    if (current.length >= 32) return;
    current.push({ label: "New", send: "" });
    props.store.update({ customKeys: current });
  }

  // [B29-C] Append a preset from the picker. Dedup by `send` so users can't
  // accidentally stack three Esc keys. Silently no-op if already present or
  // at the 32-key cap.
  function addPreset(p: UiCustomKey) {
    const current = keys().slice();
    if (current.length >= 32) return;
    if (current.some((k) => k.send === p.send)) {
      setPickerOpen(false);
      return;
    }
    current.push({ label: p.label, send: p.send, hint: p.hint });
    props.store.update({ customKeys: current });
    setPickerOpen(false);
  }

  const atCap = () => keys().length >= 32;

  return (
    <section>
      <div class="flex items-center justify-between mb-2">
        <div class="text-[10px] uppercase tracking-widest text-zinc-500">{t("settings.keys")}</div>
        <div class="flex items-center gap-1.5">
          <button
            class="text-[11px] px-2 py-0.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={atCap()}
            title="从常用转义序列中添加"
          >
            + 添加按键
          </button>
          <button
            class="text-[11px] px-2 py-0.5 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={add}
            disabled={atCap()}
            title="添加空白键位,手动填写 send"
          >
            {t("settings.addKey")}
          </button>
        </div>
      </div>
      <Show when={pickerOpen()}>
        <div class="mb-2 p-2 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-[11px] text-zinc-400">选择要添加的按键 · 已有的会被跳过</div>
            <button
              class="text-[11px] text-zinc-500 hover:text-zinc-200"
              onClick={() => setPickerOpen(false)}
            >
              ✕
            </button>
          </div>
          <For each={Object.keys(PRESET_GROUP_LABELS)}>
            {(group) => (
              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">
                  {PRESET_GROUP_LABELS[group]}
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <For each={KEY_PRESETS.filter((p) => p.group === group)}>
                    {(p) => {
                      const already = () => keys().some((k) => k.send === p.send);
                      return (
                        <button
                          class={`text-[11px] px-2 py-1 rounded border font-mono ${
                            already()
                              ? "border-zinc-900 bg-zinc-900 text-zinc-600 cursor-default"
                              : "border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-accent-500"
                          }`}
                          onClick={() => !already() && addPreset(p)}
                          disabled={already()}
                          title={p.hint ?? p.label}
                        >
                          {p.label}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="space-y-1.5">
        <div class="grid grid-cols-[32px_80px_1fr_1fr_28px] gap-2 text-[10px] text-zinc-600 px-1">
          <div>排序</div>
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
                isFirst={i() === 0}
                isLast={i() === keys().length - 1}
                onLabel={(v) => replaceAt(i(), { label: v })}
                onSend={(v) => replaceAt(i(), { send: v })}
                onHint={(v) => replaceAt(i(), { hint: v })}
                onMoveUp={() => moveAt(i(), -1)}
                onMoveDown={() => moveAt(i(), 1)}
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
  isFirst: boolean;
  isLast: boolean;
  onLabel: (v: string) => void;
  onSend: (v: string) => void;
  onHint: (v: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
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
    <div class="grid grid-cols-[32px_80px_1fr_1fr_28px] gap-2 items-center">
      <div class="flex flex-col items-center justify-center -my-0.5">
        <button
          class="text-zinc-600 hover:text-zinc-200 text-[10px] leading-none py-0.5 disabled:opacity-20 disabled:cursor-not-allowed"
          onClick={props.onMoveUp}
          disabled={props.isFirst}
          title="上移"
          aria-label="上移"
        >
          ▲
        </button>
        <button
          class="text-zinc-600 hover:text-zinc-200 text-[10px] leading-none py-0.5 disabled:opacity-20 disabled:cursor-not-allowed"
          onClick={props.onMoveDown}
          disabled={props.isLast}
          title="下移"
          aria-label="下移"
        >
          ▼
        </button>
      </div>
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

/**
 * [B31-B] About / diagnostics section — currently just the bug-report entry
 * point. Kept minimal so future entries (version info, licenses, doc links)
 * can slot in without disturbing the settings layout.
 */
function AboutSection(props: { onOpenBugReport: () => void }) {
  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
        关于与诊断
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm text-zinc-200">报告 Bug</div>
          <div class="text-[11px] text-zinc-500">
            生成诊断快照(JSON),自动脱敏令牌与绝对路径。不会上传任何数据。
          </div>
        </div>
        <button
          class="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-zinc-800 text-zinc-300 hover:bg-zinc-900 hover:border-zinc-700"
          onClick={props.onOpenBugReport}
        >
          🐞 打开
        </button>
      </div>
    </section>
  );
}

/**
 * [B31-C] Sensitive-redacted log export. Calls host endpoint
 * GET /api/v1/logs/export which bundles the last 1000 audit entries,
 * last 500 crash lines, version summary, and a redacted copy of
 * ~/.rcc/config.json (token / password / secret / key / credentials /
 * cert / vapid fields become "[REDACTED]"). The raw JSON is saved as
 * rcc-logs-<ts>.json using an object-URL anchor; no upload, nothing
 * leaves the device unless the user attaches the file themselves.
 */
function LogsExportSection() {
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  async function run() {
    if (busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const token = loadToken();
      const headers: Record<string, string> = {};
      if (token) headers["authorization"] = `Bearer ${token}`;
      const resp = await fetch("/api/v1/logs/export", { headers });
      if (!resp.ok) {
        throw new Error(`导出失败 (HTTP ${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/T/, "_")
        .replace(/Z$/, "");
      a.href = url;
      a.download = `rcc-logs-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Release the object URL on the next tick — Safari needs the
      // anchor to have fired its download before we revoke.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
        日志导出
      </div>
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm text-zinc-200">导出诊断日志</div>
          <div class="text-[11px] text-zinc-500">
            打包最近 1000 条审计 + 500 行崩溃日志 + 版本与脱敏后的 config,
            令牌/密钥/凭证字段自动替换为 [REDACTED]。
          </div>
          <Show when={err()}>
            <div class="text-[11px] text-rose-400 mt-1">{err()}</div>
          </Show>
        </div>
        <button
          class="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-zinc-800 text-zinc-300 hover:bg-zinc-900 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={run}
          disabled={busy()}
        >
          {busy() ? "导出中…" : "📥 导出日志"}
        </button>
      </div>
    </section>
  );
}
