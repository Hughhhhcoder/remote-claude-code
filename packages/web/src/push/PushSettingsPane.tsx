import { createSignal, onMount, Show } from "solid-js";
import type { RccClient } from "../client.ts";
import {
  disablePush,
  enablePush,
  getPushStatus,
  sendTestPush,
  type PushState,
} from "../push.ts";

/**
 * Settings pane for Web Push / VAPID subscriptions.
 *
 * Scope (this batch):
 *  - Current device subscription status + enable/disable.
 *  - Send test notification.
 *  - Last-test timestamp (tracked client-side in localStorage —
 *    there's no `push.last-sent` frame yet).
 *  - Empty-state CTA when the user has no subscription.
 *
 * Out of scope (deferred — would require protocol changes):
 *  - List of all devices subscribed on this host. Would need new
 *    `push.list.request` / `push.list` frames on the protocol.
 *    We intentionally do NOT add those in B22-A per the task
 *    constraint "Do NOT modify protocol frames".
 */

const LAST_TEST_KEY = "rcc.push.lastTestAt";

function formatTime(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleString();
}

function endpointOrigin(endpoint: string | null): string {
  if (!endpoint) return "";
  try {
    const u = new URL(endpoint);
    return u.origin;
  } catch {
    return endpoint.slice(0, 48);
  }
}

function endpointFingerprint(endpoint: string | null): string {
  if (!endpoint) return "";
  // Last 12 chars — stable across sessions, opaque enough.
  return endpoint.slice(-12);
}

export interface PushSettingsPaneProps {
  client: RccClient;
}

export function PushSettingsPane(props: PushSettingsPaneProps) {
  const [state, setState] = createSignal<PushState>({
    status: "default",
    endpoint: null,
  });
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [lastTestAt, setLastTestAt] = createSignal<number | null>(null);

  onMount(async () => {
    try {
      setState(await getPushStatus());
    } catch {
      // best-effort
    }
    try {
      const raw = localStorage.getItem(LAST_TEST_KEY);
      if (raw) {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n)) setLastTestAt(n);
      }
    } catch {
      // ignore storage issues
    }
  });

  async function onEnable() {
    setBusy(true);
    setErr(null);
    try {
      setState(await enablePush(props.client));
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
      setState(await disablePush(props.client));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onTest() {
    sendTestPush(props.client);
    const now = Date.now();
    setLastTestAt(now);
    try {
      localStorage.setItem(LAST_TEST_KEY, String(now));
    } catch {
      // ignore
    }
  }

  function statusLabel(): string {
    const s = state().status;
    if (s === "unsupported") return "浏览器不支持 Web Push";
    if (s === "denied") return "通知被浏览器拒绝";
    if (s === "granted-on") return "已订阅";
    if (s === "granted-off") return "已授权, 未订阅";
    return "未启用";
  }

  function statusTone(): string {
    const s = state().status;
    if (s === "granted-on") return "text-[rgb(var(--success))]";
    if (s === "denied" || s === "unsupported") return "text-[rgb(var(--danger))]";
    return "text-text-muted";
  }

  const subscribed = () => state().status === "granted-on";

  return (
    <div class="flex flex-col gap-6 text-text-primary">
      <header>
        <h2 class="font-serif text-xl text-text-primary">通知 · VAPID 订阅</h2>
        <p class="text-sm text-text-secondary mt-1">
          Web Push 让 RCC 在浏览器后台或锁屏唤醒审批提醒。订阅以设备为单位。
        </p>
      </header>

      <section class="rounded-[var(--radius-md)] bg-bg-surface border border-border-subtle p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[11px] uppercase tracking-wide text-text-muted">本设备</div>
            <div class={`text-sm font-medium ${statusTone()}`}>{statusLabel()}</div>
          </div>
          <Show when={subscribed()} fallback={
            <button
              type="button"
              class="h-9 px-4 rounded-md text-sm bg-accent hover:bg-accent-hover text-white disabled:opacity-50"
              disabled={busy() || state().status === "unsupported" || state().status === "denied"}
              onClick={onEnable}
            >
              {busy() ? "请稍候…" : "启用推送"}
            </button>
          }>
            <button
              type="button"
              class="h-9 px-4 rounded-md text-sm border border-[rgb(var(--danger))]/40 text-[rgb(var(--danger))] hover:bg-[rgb(var(--danger))]/10 disabled:opacity-50"
              disabled={busy()}
              onClick={onDisable}
            >
              {busy() ? "请稍候…" : "关闭推送"}
            </button>
          </Show>
        </div>
        <Show when={subscribed() && state().endpoint}>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt class="text-text-muted">端点域名</dt>
            <dd class="font-mono text-text-secondary truncate">{endpointOrigin(state().endpoint)}</dd>
            <dt class="text-text-muted">指纹</dt>
            <dd class="font-mono text-text-secondary">…{endpointFingerprint(state().endpoint)}</dd>
            <dt class="text-text-muted">最近测试</dt>
            <dd class="text-text-secondary">{formatTime(lastTestAt())}</dd>
          </dl>
        </Show>
        <Show when={err()}>
          <div class="text-xs text-[rgb(var(--danger))]">{err()}</div>
        </Show>
      </section>

      <section class="rounded-[var(--radius-md)] bg-bg-surface border border-border-subtle p-4 flex flex-col gap-3">
        <div>
          <div class="text-[11px] uppercase tracking-wide text-text-muted">测试</div>
          <div class="text-sm text-text-secondary mt-1">
            触发一条通知以确认订阅链路 (host → 浏览器推送服务 → Service Worker)。
          </div>
        </div>
        <div>
          <button
            type="button"
            class="h-9 px-4 rounded-md text-sm border border-border-strong text-text-primary hover:bg-bg-surfaceStrong disabled:opacity-50"
            disabled={!subscribed()}
            onClick={onTest}
          >
            发送测试通知
          </button>
        </div>
      </section>

      <section class="rounded-[var(--radius-md)] bg-bg-surface border border-border-subtle p-4">
        <div class="text-[11px] uppercase tracking-wide text-text-muted mb-2">所有订阅的设备</div>
        <Show when={subscribed()} fallback={
          <div class="text-sm text-text-secondary">
            尚未订阅任何设备。点击上方"启用推送"即可在此设备上接收通知。
          </div>
        }>
          <div class="text-sm text-text-secondary">
            <p>
              多设备清单需要协议新增 <code class="font-mono text-xs">push.list.request</code> 帧,
              将于后续批次(B22-B/C)实现。目前只能管理 <strong>本设备</strong> 的订阅。
            </p>
            <p class="mt-2 text-xs text-text-muted">
              如需关闭其他设备的订阅, 可在该设备上打开此面板并点击"关闭推送"。
            </p>
          </div>
        </Show>
      </section>
    </div>
  );
}

export default PushSettingsPane;
