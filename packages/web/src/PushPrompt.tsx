import { createSignal, onMount, Show } from "solid-js";
import type { RccClient } from "./client.ts";
import {
  disablePush,
  enablePush,
  getPushStatus,
  sendTestPush,
  type PushState,
} from "./push.ts";

/**
 * Bell button in the top bar that toggles Web Push and surfaces a tiny menu
 * when already on.
 *
 *   off            grey bell     → click → enablePush()
 *   on             orange bell   → click → dropdown [测试] [关闭]
 *   denied / noop  faded bell    → title explains
 */
export function PushPrompt(props: { client: RccClient }) {
  const [state, setState] = createSignal<PushState>({ status: "default", endpoint: null });
  const [busy, setBusy] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      setState(await getPushStatus());
    } catch {
      // best-effort
    }
  });

  async function onEnable() {
    setBusy(true);
    setErr(null);
    try {
      const s = await enablePush(props.client);
      setState(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    setErr(null);
    try {
      const s = await disablePush(props.client);
      setState(s);
      setMenuOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onTest() {
    sendTestPush(props.client);
    setMenuOpen(false);
  }

  function onClick() {
    if (busy()) return;
    const s = state().status;
    if (s === "unsupported" || s === "denied") return;
    if (s === "granted-on") {
      setMenuOpen((v) => !v);
      return;
    }
    void onEnable();
  }

  function label(): string {
    const s = state().status;
    if (s === "unsupported") return "浏览器不支持 Web Push";
    if (s === "denied") return "通知已被浏览器拒绝 — 请到站点设置恢复";
    if (s === "granted-on") return "通知已开启 · 点击管理";
    if (s === "granted-off") return "已授权,尚未订阅 — 点击开启推送";
    return err() ?? "开启通知以在锁屏接收审批提醒";
  }

  function tone(): string {
    const s = state().status;
    if (s === "granted-on") return "text-orange-400 hover:text-orange-300";
    if (s === "unsupported" || s === "denied") return "text-zinc-700 cursor-not-allowed";
    if (busy()) return "text-zinc-500 animate-pulse";
    return "text-zinc-500 hover:text-zinc-200";
  }

  return (
    <div class="relative">
      <button
        type="button"
        class={`text-base leading-none px-1.5 py-0.5 rounded transition ${tone()}`}
        title={label()}
        aria-label={label()}
        onClick={onClick}
        disabled={busy() || state().status === "unsupported" || state().status === "denied"}
      >
        <Show when={state().status === "granted-on"} fallback={<span>🔔</span>}>
          <span>🔔</span>
        </Show>
      </button>
      <Show when={menuOpen() && state().status === "granted-on"}>
        <div
          class="absolute right-0 top-full mt-1 w-36 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl py-1 text-xs z-50"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            class="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200"
            onClick={onTest}
          >
            🧪 发送测试
          </button>
          <button
            class="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-rose-300"
            onClick={onDisable}
            disabled={busy()}
          >
            关闭通知
          </button>
        </div>
      </Show>
    </div>
  );
}
