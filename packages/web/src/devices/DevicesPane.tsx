import { createSignal, createEffect, For, Show, onCleanup, type JSX } from "solid-js";
import type { DeviceSummary } from "@rcc/protocol";
import type { RccClient } from "../client.ts";
import { registerPasskey, clearPasskey, isWebAuthnAvailable } from "../webauthn.ts";
import { Button } from "../primitives/Button.tsx";
import { Chip } from "../primitives/Chip.tsx";

/**
 * DevicesPane — P5-C responsive migration of DevicesModal. Lifts the
 * paired-device frame dispatch wholesale, drops the overlay chrome, and
 * rebuilds the shell with warm semantic tokens + Button/Chip primitives.
 *
 * Frame dispatch (unchanged): send device.list.request / device.revoke;
 * listen device.list. Passkey ceremony reuses webauthn helpers.
 */

export interface DevicesPaneProps {
  client: RccClient;
  currentDevice?: { id: string; name: string; hasPasskey?: boolean } | null;
  onPasskeyChange?: (hasPasskey: boolean) => void;
  onClose?: () => void;
}

function formatAge(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return `${Math.floor(d / 86_400_000)} 天前`;
}

function devIcon(ua: string | null | undefined): string {
  if (!ua) return "🔑";
  if (/iPhone|iPad|Android/.test(ua)) return "📱";
  if (/Macintosh|Mac OS/.test(ua)) return "💻";
  if (/Windows/.test(ua)) return "🖥";
  return "🔑";
}

export function DevicesPane(props: DevicesPaneProps): JSX.Element {
  const [devices, setDevices] = createSignal<DeviceSummary[]>([]);
  const [expandedId, setExpandedId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [pkErr, setPkErr] = createSignal<string | null>(null);

  onCleanup(
    props.client.on((f) => {
      if (f.t === "device.list") setDevices(f.devices);
    }),
  );
  createEffect(() =>
    props.client.send({ v: 1, t: "device.list.request" }),
  );

  function revoke(d: DeviceSummary): void {
    if (d.current) {
      alert("不能从此设备吊销自己。请用另一设备或 host CLI。");
      return;
    }
    if (!confirm(`确认吊销 "${d.name}"？它将立即断开。`)) return;
    props.client.send({ v: 1, t: "device.revoke", deviceId: d.id });
  }

  async function pkUpgrade(): Promise<void> {
    if (!props.currentDevice) return;
    setBusy(true);
    setPkErr(null);
    try {
      await registerPasskey(props.currentDevice.id);
      props.onPasskeyChange?.(true);
      props.client.send({ v: 1, t: "device.list.request" });
    } catch (e) {
      setPkErr((e as Error).message || "passkey 注册失败");
    } finally {
      setBusy(false);
    }
  }

  async function pkRemove(): Promise<void> {
    if (!props.currentDevice) return;
    if (!confirm("移除 Passkey？高风险审批退回单次确认。")) return;
    setBusy(true);
    setPkErr(null);
    try {
      await clearPasskey(props.currentDevice.id);
      props.onPasskeyChange?.(false);
      props.client.send({ v: 1, t: "device.list.request" });
    } catch (e) {
      setPkErr((e as Error).message || "passkey 移除失败");
    } finally {
      setBusy(false);
    }
  }

  const curr = () => devices().filter((d) => d.current);
  const others = () => devices().filter((d) => !d.current);

  return (
    <div class="flex flex-col h-full bg-bg-page text-text-primary">
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-border-subtle bg-bg-page">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">已配对设备</h2>
          <p class="text-[11px] text-text-muted mt-0.5">共 {devices().length} 台</p>
        </div>
        <Show when={props.onClose}>
          <Button variant="ghost" size="sm" onClick={props.onClose} aria-label="关闭">
            ✕
          </Button>
        </Show>
      </header>

      <div class="flex-1 overflow-y-auto">
        <Show when={props.currentDevice && isWebAuthnAvailable()}>
          <section class="px-4 md:px-5 py-3 border-b border-border-subtle bg-accent-bg/40 flex items-center gap-3 flex-wrap">
            <div class="w-9 h-9 rounded-md bg-accent/10 border border-accent/20 grid place-items-center text-base shrink-0">
              🔐
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium">Passkey（本设备）</div>
              <div class="text-[11px] text-text-secondary mt-0.5">
                <Show when={props.currentDevice?.hasPasskey} fallback={<span>升级后高风险审批需 Touch / Face ID</span>}>
                  <span class="text-accent">已启用 · 高风险走生物识别</span>
                </Show>
              </div>
              <Show when={pkErr()}>
                <div class="mt-1 text-[11px] text-danger break-words">{pkErr()}</div>
              </Show>
            </div>
            <Show
              when={props.currentDevice?.hasPasskey}
              fallback={<Button size="sm" onClick={pkUpgrade} loading={busy()}>升级 Passkey</Button>}
            >
              <Button variant="secondary" size="sm" onClick={pkRemove} loading={busy()}>移除</Button>
            </Show>
          </section>
        </Show>

        <Show when={curr().length > 0}>
          <SectionHeader title="本设备" />
          <ul class="divide-y divide-border-subtle">
            <For each={curr()}>
              {(d) => (
                <Row d={d} expanded={expandedId() === d.id}
                  onToggle={() => setExpandedId((x) => (x === d.id ? null : d.id))}
                  onRevoke={() => revoke(d)} highlight />
              )}
            </For>
          </ul>
        </Show>

        <SectionHeader title="其它设备" />
        <Show
          when={others().length > 0}
          fallback={<div class="px-4 md:px-5 py-8 text-center text-[13px] text-text-muted">还没有其它配对设备。</div>}
        >
          <ul class="divide-y divide-border-subtle">
            <For each={others()}>
              {(d) => (
                <Row d={d} expanded={expandedId() === d.id}
                  onToggle={() => setExpandedId((x) => (x === d.id ? null : d.id))}
                  onRevoke={() => revoke(d)} />
              )}
            </For>
          </ul>
        </Show>
      </div>

      <footer class="shrink-0 border-t border-border-subtle px-4 md:px-5 py-2.5 flex items-center justify-between gap-2 text-[11px] text-text-muted bg-bg-surface">
        <span class="truncate">吊销后设备立即断开，token 失效。</span>
        <Button variant="ghost" size="sm" onClick={() => props.client.send({ v: 1, t: "device.list.request" })}>
          ⟳ 刷新
        </Button>
      </footer>
    </div>
  );
}

function SectionHeader(p: { title: string }): JSX.Element {
  return (
    <h3 class="px-4 md:px-5 pt-4 pb-1 text-[10px] uppercase tracking-widest text-text-muted">{p.title}</h3>
  );
}

interface RowProps {
  d: DeviceSummary;
  expanded: boolean;
  highlight?: boolean;
  onToggle: () => void;
  onRevoke: () => void;
}

function Row(p: RowProps): JSX.Element {
  const copy = (): void => { navigator.clipboard?.writeText(p.d.id).catch(() => {}); };
  return (
    <li class={`px-4 md:px-5 py-3 min-h-[80px] md:min-h-[72px] flex items-start gap-3 ${p.highlight ? "bg-accent-bg/30" : ""}`}>
      <button type="button" onClick={p.onToggle}
        class="w-10 h-10 rounded-md bg-bg-surfaceStrong grid place-items-center text-base shrink-0"
        aria-label="展开">
        {devIcon(p.d.userAgent)}
      </button>
      <div class="flex-1 min-w-0">
        <button type="button" onClick={p.onToggle} class="text-left w-full">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[13px] font-medium truncate">{p.d.name}</span>
            <Show when={p.d.current}><Chip tone="accent" size="xs">当前设备</Chip></Show>
          </div>
          <div class="text-[11px] text-text-muted mt-1 flex items-center gap-2 flex-wrap">
            <span>上次活动 {formatAge(p.d.lastSeenAt)}</span>
            <span class="text-text-muted/50">·</span>
            <span>配对于 {formatAge(p.d.createdAt)}</span>
          </div>
        </button>
        <Show when={p.expanded}>
          <div class="mt-2 rounded-md border border-border-subtle bg-bg-surface p-2 space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] uppercase tracking-widest text-text-muted">Device ID</span>
              <Button variant="ghost" size="sm" onClick={copy} aria-label="复制">复制</Button>
            </div>
            <div class="font-mono text-[11px] text-text-secondary break-all">{p.d.id}</div>
            <Show when={p.d.userAgent}>
              <div class="pt-1 border-t border-border-subtle">
                <div class="text-[10px] uppercase tracking-widest text-text-muted">User Agent</div>
                <div class="font-mono text-[11px] text-text-muted break-all">{p.d.userAgent}</div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <div class="flex flex-col md:flex-row items-end md:items-center gap-1.5 shrink-0">
        <Button variant="ghost" size="sm" onClick={p.onRevoke} disabled={p.d.current}
          class="text-danger hover:bg-danger/5">吊销</Button>
      </div>
    </li>
  );
}

export default DevicesPane;
