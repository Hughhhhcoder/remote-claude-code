import { createSignal, createMemo, For, Show, onCleanup } from "solid-js";
import type { MetricsSnapshot } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

/**
 * Observability popover. Opens from the top bar, subscribes to `metrics.tick`
 * while visible, and renders inline-SVG sparklines for RSS + CPU% plus a few
 * numeric counters. No chart lib — sparklines are hand-rolled. Closing the
 * popover sends `metrics.unsubscribe` so the host stops ticking to this peer.
 */
export function MetricsPanel(props: { client: RccClient }) {
  const [open, setOpen] = createSignal(false);
  const [snap, setSnap] = createSignal<MetricsSnapshot | null>(null);

  const unsubFrame = props.client.on((frame) => {
    if (frame.t === "metrics.tick") setSnap(frame.snapshot);
  });
  onCleanup(() => {
    unsubFrame();
    if (open()) props.client.send({ v: 1, t: "metrics.unsubscribe" });
  });

  function toggle() {
    const next = !open();
    setOpen(next);
    if (next) {
      props.client.send({ v: 1, t: "metrics.subscribe" });
    } else {
      props.client.send({ v: 1, t: "metrics.unsubscribe" });
    }
  }

  return (
    <div class="relative">
      <button
        onClick={toggle}
        class={`text-[11px] px-2 py-1 rounded border font-medium ${
          open()
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
        }`}
        title="观测面板"
      >
        📊
      </button>
      <Show when={open()}>
        <div class="absolute right-0 top-full mt-1 z-40 w-[340px] rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl p-3 space-y-3">
          <Show
            when={snap()}
            fallback={<div class="text-xs text-zinc-500">等待数据…</div>}
          >
            <PanelBody snap={snap()!} />
          </Show>
        </div>
      </Show>
    </div>
  );
}

function PanelBody(props: { snap: MetricsSnapshot }) {
  const s = () => props.snap;
  return (
    <>
      <SectionHeader label="Process" />
      <div class="grid grid-cols-2 gap-2 text-[11px]">
        <Metric
          label="RSS"
          value={formatBytes(s().process.rss)}
          series={s().rssSeries}
          color="#f97316"
          max={Math.max(...s().rssSeries, 1)}
        />
        <Metric
          label="CPU%"
          value={`${s().process.cpuPct.toFixed(1)}%`}
          series={s().cpuSeries}
          color="#10b981"
          max={100}
        />
      </div>
      <div class="grid grid-cols-3 gap-2 text-[10px] text-zinc-400">
        <KV k="heap" v={formatBytes(s().process.heapUsed)} />
        <KV k="heap max" v={formatBytes(s().process.heapTotal)} />
        <KV k="uptime" v={formatUptime(s().uptimeSec)} />
      </div>

      <SectionHeader label="Sessions" />
      <div class="flex items-center gap-2 text-[11px]">
        <Bar label="running" n={s().sessions.running} total={Math.max(s().sessions.total, 1)} color="bg-emerald-500" />
        <Bar label="exited" n={s().sessions.exited} total={Math.max(s().sessions.total, 1)} color="bg-zinc-600" />
      </div>
      <div class="flex items-center gap-3 text-[10px] text-zinc-400">
        <span>CLI: {s().sessions.byDriver.cli}</span>
        <span>SDK: {s().sessions.byDriver.sdk}</span>
      </div>

      <SectionHeader label="WebSocket" />
      <div class="grid grid-cols-2 gap-2 text-[11px]">
        <Metric
          label="in B/s"
          value={formatBytes(s().ws.bytesInPerSec)}
          series={s().ws.bytesInSeries}
          color="#38bdf8"
          max={Math.max(...s().ws.bytesInSeries, 1)}
        />
        <Metric
          label="out B/s"
          value={formatBytes(s().ws.bytesOutPerSec)}
          series={s().ws.bytesOutSeries}
          color="#a78bfa"
          max={Math.max(...s().ws.bytesOutSeries, 1)}
        />
      </div>
      <div class="grid grid-cols-3 gap-2 text-[10px] text-zinc-400">
        <KV k="msgs in/s" v={String(s().ws.msgsInPerSec)} />
        <KV k="msgs out/s" v={String(s().ws.msgsOutPerSec)} />
        <KV k="subs" v={`${s().ws.subscribers}/${s().ws.connections}`} />
      </div>

      <SectionHeader label="Counters" />
      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Counter label="crashes" v={s().counters.crashes} warn={s().counters.crashes > 0} />
        <Counter label="replay rej" v={s().counters.replayRejects} warn={s().counters.replayRejects > 0} />
        <Counter label="decrypt fail" v={s().counters.decryptFails} warn={s().counters.decryptFails > 0} />
        <Counter label="auth fail" v={s().counters.authFails} warn={s().counters.authFails > 0} />
      </div>
    </>
  );
}

function SectionHeader(props: { label: string }) {
  return (
    <div class="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold">
      {props.label}
    </div>
  );
}

function Metric(props: {
  label: string;
  value: string;
  series: number[];
  color: string;
  max: number;
}) {
  return (
    <div class="rounded border border-zinc-800 bg-zinc-900/40 p-2">
      <div class="flex items-baseline justify-between">
        <span class="text-[10px] text-zinc-500">{props.label}</span>
        <span class="text-xs font-mono text-zinc-100">{props.value}</span>
      </div>
      <Sparkline series={props.series} color={props.color} max={props.max} />
    </div>
  );
}

function Sparkline(props: { series: number[]; color: string; max: number }) {
  const path = createMemo(() => {
    const s = props.series;
    if (s.length === 0) return "";
    const w = 120;
    const h = 24;
    const max = props.max || 1;
    const step = w / Math.max(s.length - 1, 1);
    let d = "";
    for (let i = 0; i < s.length; i++) {
      const x = i * step;
      const y = h - (s[i]! / max) * h;
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    return d.trim();
  });
  return (
    <svg viewBox="0 0 120 24" class="w-full h-6 mt-1" preserveAspectRatio="none">
      <path d={path()} fill="none" stroke={props.color} stroke-width="1.2" />
    </svg>
  );
}

function Bar(props: { label: string; n: number; total: number; color: string }) {
  const pct = () => Math.round((props.n / Math.max(props.total, 1)) * 100);
  return (
    <div class="flex-1">
      <div class="flex justify-between text-[10px] text-zinc-400">
        <span>{props.label}</span>
        <span class="font-mono">{props.n}</span>
      </div>
      <div class="h-1.5 bg-zinc-800 rounded overflow-hidden mt-0.5">
        <div class={`h-full ${props.color}`} style={{ width: `${pct()}%` }} />
      </div>
    </div>
  );
}

function Counter(props: { label: string; v: number; warn: boolean }) {
  return (
    <div class="flex items-center justify-between">
      <span class="text-zinc-500">{props.label}</span>
      <span
        class={`font-mono ${
          props.warn ? "text-rose-400" : "text-zinc-300"
        }`}
      >
        {props.v}
      </span>
    </div>
  );
}

function KV(props: { k: string; v: string }) {
  return (
    <div class="flex items-center justify-between gap-1">
      <span>{props.k}</span>
      <span class="font-mono text-zinc-300">{props.v}</span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// Silence unused-import warnings in environments where For isn't tree-shaken.
void For;
