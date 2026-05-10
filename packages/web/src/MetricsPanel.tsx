import { createSignal, createMemo, For, Show, onCleanup } from "solid-js";
import type { MetricsSnapshot, SessionMeta, Frame } from "@rcc/protocol";
import type { RccClient } from "./client.ts";
import { t } from "./i18n/index.ts";
import { SparklineSVG, type SparklineTone } from "./primitives/Sparkline.tsx";

/**
 * MetricsPanel — v0.2 redesign.
 *
 * Observability popover opened from the top bar. Subscribes to
 * `metrics.tick` while visible. Lays out a grid of cards, each card
 * pairs a numeric value with a tiny SVG sparkline of the last N samples
 * (series fields from the host snapshot). Uses the locked design tokens
 * (accent / success / warn / danger) and Charter serif for card titles.
 *
 * Client-side augmentations (not in the host snapshot):
 *   - Active-session series: sampled from every tick.
 *   - Approval latency p50/p95: measured in the browser by correlating
 *     `approval.request` (timestamp) with `approval.response` / `approval.cleared`.
 *     Kept as a rolling window of the last 50 completed approvals.
 *   - Per-session message count: derived from `sessions[].usage.turns`,
 *     rendered as a horizontal bar chart (top 6 by turn count).
 *
 * Mobile: single-column stack < 640px; 2 cols up to 1024px; 3 cols above.
 * No frame-protocol changes — approval timing is inferred client-side.
 */

const SERIES_CAP = 60;

export function MetricsPanel(props: { client: RccClient; sessions?: SessionMeta[] }) {
  const [open, setOpen] = createSignal(false);
  const [snap, setSnap] = createSignal<MetricsSnapshot | null>(null);

  // Client-augmented series that are NOT in the host snapshot.
  const [activeSessionSeries, setActiveSessionSeries] = createSignal<number[]>([]);
  const [crashSeries, setCrashSeries] = createSignal<number[]>([]);

  // Approval latency tracking. Pending map: id → requestAt (ms).
  const pending = new Map<string, number>();
  const [approvalLatencies, setApprovalLatencies] = createSignal<number[]>([]);

  const unsubFrame = props.client.on((frame: Frame) => {
    if (frame.t === "metrics.tick") {
      const s = frame.snapshot;
      setSnap(s);
      setActiveSessionSeries((prev) =>
        [...prev, s.sessions.running].slice(-SERIES_CAP),
      );
      setCrashSeries((prev) =>
        [...prev, s.counters.crashes].slice(-SERIES_CAP),
      );
    } else if (frame.t === "approval.request") {
      pending.set(frame.id, Date.now());
    } else if (frame.t === "approval.response" || frame.t === "approval.cleared") {
      const startedAt = pending.get(frame.id);
      if (startedAt !== undefined) {
        pending.delete(frame.id);
        const dt = Date.now() - startedAt;
        setApprovalLatencies((prev) => [...prev, dt].slice(-50));
      }
    }
  });
  onCleanup(() => {
    unsubFrame();
    if (open()) props.client.send({ v: 1, t: "metrics.unsubscribe" });
  });

  function toggle() {
    const next = !open();
    setOpen(next);
    if (next) props.client.send({ v: 1, t: "metrics.subscribe" });
    else props.client.send({ v: 1, t: "metrics.unsubscribe" });
  }

  const approvalStats = createMemo(() => {
    const arr = approvalLatencies();
    if (arr.length === 0) return { p50: 0, p95: 0, count: 0, series: [] as number[] };
    const sorted = [...arr].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    return { p50, p95, count: arr.length, series: arr };
  });

  const usageTotals = createMemo(() => {
    const list = props.sessions ?? [];
    let input = 0;
    let output = 0;
    let cacheCreate = 0;
    let cacheRead = 0;
    let cost = 0;
    let turns = 0;
    let n = 0;
    for (const s of list) {
      if (!s.usage) continue;
      n++;
      input += s.usage.inputTokens;
      output += s.usage.outputTokens;
      cacheCreate += s.usage.cacheCreateTokens;
      cacheRead += s.usage.cacheReadTokens;
      cost += s.usage.costUsd;
      turns += s.usage.turns;
    }
    return { input, output, cacheCreate, cacheRead, cost, turns, n };
  });

  /**
   * Per-session message counts (top 6 by turns) — used by the
   * "Messages per session" card.
   */
  const topSessions = createMemo(() => {
    const list = (props.sessions ?? [])
      .filter((s) => s.usage && s.usage.turns > 0)
      .map((s) => ({
        id: s.id,
        label: sessionLabel(s),
        turns: s.usage!.turns,
      }))
      .sort((a, b) => b.turns - a.turns)
      .slice(0, 6);
    const max = list.reduce((a, b) => (b.turns > a ? b.turns : a), 1);
    return { list, max };
  });

  return (
    <div class="relative">
      <button
        onClick={toggle}
        class={`text-[11px] px-2 py-1 rounded-sm border font-sans font-medium transition-colors duration-fast ease-rcc ${
          open()
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border-subtle bg-bg-surface text-text-secondary hover:text-text-primary hover:border-border-strong"
        }`}
        title={t("top.metricsTitle")}
        aria-expanded={open()}
      >
        <span aria-hidden="true">📊</span>
      </button>
      <Show when={open()}>
        <div
          class="
            absolute right-0 top-full mt-1 z-40
            w-[min(92vw,720px)]
            max-h-[min(80vh,640px)] overflow-y-auto
            rounded-lg border border-border-subtle bg-bg-surface shadow-xl
            p-3 sm:p-4
          "
          role="dialog"
          aria-label={t("top.metricsTitle")}
        >
          <Show
            when={snap()}
            fallback={
              <div class="text-xs text-text-muted font-sans py-6 text-center">
                {t("metrics.waiting")}
              </div>
            }
          >
            <PanelBody
              snap={snap()!}
              usage={usageTotals()}
              activeSeries={activeSessionSeries()}
              crashSeries={crashSeries()}
              approval={approvalStats()}
              topSessions={topSessions()}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ─── Panel body ───────────────────────────────────────────────────────

interface ApprovalStats {
  p50: number;
  p95: number;
  count: number;
  series: number[];
}

interface TopSessionsData {
  list: { id: string; label: string; turns: number }[];
  max: number;
}

function PanelBody(props: {
  snap: MetricsSnapshot;
  usage: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
    cost: number;
    turns: number;
    n: number;
  };
  activeSeries: number[];
  crashSeries: number[];
  approval: ApprovalStats;
  topSessions: TopSessionsData;
}) {
  const s = () => props.snap;
  const u = () => props.usage;

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="flex items-baseline justify-between gap-2">
        <div>
          <h2 class="font-serif text-[18px] leading-tight text-text-primary m-0">
            Metrics
          </h2>
          <div class="text-[11px] font-sans text-text-muted mt-0.5">
            uptime {formatUptime(s().uptimeSec)} · {s().ws.connections} conn · {s().ws.subscribers} subs
          </div>
        </div>
        <span class="text-[10px] font-mono text-text-muted">
          {new Date(s().at).toLocaleTimeString()}
        </span>
      </div>

      {/* Card grid */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {/* WS bytes in */}
        <MetricCard
          title="WS bytes in/s"
          value={formatBytes(s().ws.bytesInPerSec)}
          sub={`${s().ws.msgsInPerSec} msg/s`}
          tone="accent"
          series={s().ws.bytesInSeries}
        />
        {/* WS bytes out */}
        <MetricCard
          title="WS bytes out/s"
          value={formatBytes(s().ws.bytesOutPerSec)}
          sub={`${s().ws.msgsOutPerSec} msg/s`}
          tone="accent"
          series={s().ws.bytesOutSeries}
        />
        {/* Active sessions over time */}
        <MetricCard
          title="Active sessions"
          value={String(s().sessions.running)}
          sub={`${s().sessions.total} total · cli ${s().sessions.byDriver.cli} / sdk ${s().sessions.byDriver.sdk}`}
          tone="success"
          series={props.activeSeries}
        />
        {/* Approval latency */}
        <MetricCard
          title="Approval latency"
          value={props.approval.count > 0 ? `${formatMs(props.approval.p50)} p50` : "—"}
          sub={
            props.approval.count > 0
              ? `${formatMs(props.approval.p95)} p95 · ${props.approval.count} samples`
              : "no approvals yet"
          }
          tone={props.approval.p95 > 10_000 ? "warn" : "accent"}
          series={props.approval.series}
        />
        {/* Memory (RSS) */}
        <MemoryGauge snap={s()} />
        {/* Crashes & stability */}
        <CrashGauge snap={s()} crashSeries={props.crashSeries} />
      </div>

      {/* Messages per session (bar by session) */}
      <section>
        <SectionHeader label="Messages per session" />
        <Show
          when={props.topSessions.list.length > 0}
          fallback={
            <div class="text-xs text-text-muted font-sans py-3 text-center">
              no session activity yet
            </div>
          }
        >
          <ul class="space-y-1.5 mt-2">
            <For each={props.topSessions.list}>
              {(item) => (
                <SessionBar
                  label={item.label}
                  turns={item.turns}
                  max={props.topSessions.max}
                />
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* Usage totals */}
      <Show when={u().n > 0}>
        <section>
          <SectionHeader label={`Usage · ${u().n} session${u().n === 1 ? "" : "s"}`} />
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px] font-sans mt-2">
            <KV k="↑ input" v={formatTokens(u().input)} />
            <KV k="↓ output" v={formatTokens(u().output)} />
            <KV k="cache create" v={formatTokens(u().cacheCreate)} />
            <KV k="cache read" v={formatTokens(u().cacheRead)} />
            <KV k="cost" v={`$${u().cost.toFixed(4)}`} />
            <KV k="turns" v={String(u().turns)} />
          </div>
        </section>
      </Show>

      {/* Counters */}
      <section>
        <SectionHeader label="Counters" />
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] font-sans mt-2">
          <Counter label="crashes" v={s().counters.crashes} warn={s().counters.crashes > 0} />
          <Counter label="replay rej" v={s().counters.replayRejects} warn={s().counters.replayRejects > 0} />
          <Counter label="decrypt fail" v={s().counters.decryptFails} warn={s().counters.decryptFails > 0} />
          <Counter label="auth fail" v={s().counters.authFails} warn={s().counters.authFails > 0} />
          <Counter label="bp drops" v={s().counters.wsDropsBackpressure} warn={s().counters.wsDropsBackpressure > 0} />
          <Counter label="rl drops" v={s().counters.wsDropsRateLimit} warn={s().counters.wsDropsRateLimit > 0} />
          <Counter label="bp closes" v={s().counters.wsClosesBackpressure} warn={s().counters.wsClosesBackpressure > 0} />
          <Counter label="rl closes" v={s().counters.wsClosesRateLimit} warn={s().counters.wsClosesRateLimit > 0} />
        </div>
      </section>
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────

function MetricCard(props: {
  title: string;
  value: string;
  sub?: string;
  tone: SparklineTone;
  series: number[];
}) {
  return (
    <div class="rounded-md border border-border-subtle bg-bg-surfaceStrong/60 p-2.5 flex flex-col gap-1.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-serif text-[13px] leading-tight text-text-primary truncate">
            {props.title}
          </div>
          <Show when={props.sub}>
            <div class="text-[10px] font-sans text-text-muted truncate mt-0.5">
              {props.sub}
            </div>
          </Show>
        </div>
        <div class="text-[14px] font-mono text-text-primary tabular-nums whitespace-nowrap">
          {props.value}
        </div>
      </div>
      <SparklineSVG
        points={props.series}
        tone={props.tone}
        height={32}
        label={`${props.title} sparkline`}
      />
    </div>
  );
}

/**
 * Memory gauge — RSS displayed as a filled bar vs. a heuristic ceiling
 * (max of heapTotal and observed series peak) plus the RSS sparkline.
 */
function MemoryGauge(props: { snap: MetricsSnapshot }) {
  const s = () => props.snap;
  const ceiling = createMemo(() => {
    const peak = s().rssSeries.reduce((a, b) => (b > a ? b : a), 0);
    return Math.max(s().process.heapTotal * 1.5, peak, s().process.rss * 1.2, 1);
  });
  const pct = () => Math.min(100, (s().process.rss / ceiling()) * 100);
  const tone: SparklineTone = pct() > 80 ? "warn" : "accent";
  const barColor =
    pct() > 90 ? "bg-danger" : pct() > 70 ? "bg-warn" : "bg-accent";

  return (
    <div class="rounded-md border border-border-subtle bg-bg-surfaceStrong/60 p-2.5 flex flex-col gap-1.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-serif text-[13px] leading-tight text-text-primary truncate">
            Memory
          </div>
          <div class="text-[10px] font-sans text-text-muted truncate mt-0.5">
            heap {formatBytes(s().process.heapUsed)} / {formatBytes(s().process.heapTotal)} · cpu {s().process.cpuPct.toFixed(1)}%
          </div>
        </div>
        <div class="text-[14px] font-mono text-text-primary tabular-nums whitespace-nowrap">
          {formatBytes(s().process.rss)}
        </div>
      </div>
      <div
        class="h-1.5 bg-bg-surface rounded-sm overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct())}
        aria-label="RSS usage"
      >
        <div class={`h-full ${barColor} transition-all duration-fast ease-rcc`} style={{ width: `${pct()}%` }} />
      </div>
      <SparklineSVG
        points={s().rssSeries}
        tone={tone}
        height={24}
        label="RSS sparkline"
      />
    </div>
  );
}

/**
 * Crash / stability gauge — emphasizes the crash counter when non-zero
 * and shows a sparkline of crash-count growth across the session.
 */
function CrashGauge(props: { snap: MetricsSnapshot; crashSeries: number[] }) {
  const s = () => props.snap;
  const crashes = () => s().counters.crashes;
  const dangerous = () => crashes() > 0;
  const tone: SparklineTone = dangerous() ? "danger" : "success";

  return (
    <div
      class={`rounded-md border p-2.5 flex flex-col gap-1.5 ${
        dangerous()
          ? "border-danger/40 bg-danger/5"
          : "border-border-subtle bg-bg-surfaceStrong/60"
      }`}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div
            class={`font-serif text-[13px] leading-tight truncate ${
              dangerous() ? "text-danger" : "text-text-primary"
            }`}
          >
            Crashes
          </div>
          <div class="text-[10px] font-sans text-text-muted truncate mt-0.5">
            {dangerous() ? "check ~/.rcc/crashes.log" : "no crashes recorded"}
          </div>
        </div>
        <div
          class={`text-[14px] font-mono tabular-nums whitespace-nowrap ${
            dangerous() ? "text-danger" : "text-success"
          }`}
        >
          {crashes()}
        </div>
      </div>
      <SparklineSVG
        points={props.crashSeries}
        tone={tone}
        height={32}
        showLastDot={dangerous()}
        label="crash series"
      />
    </div>
  );
}

/**
 * A per-session horizontal bar used in the "Messages per session" list.
 */
function SessionBar(props: { label: string; turns: number; max: number }) {
  const pct = () => Math.round((props.turns / Math.max(props.max, 1)) * 100);
  return (
    <li class="flex items-center gap-2 text-[11px] font-sans">
      <span class="w-[40%] sm:w-[30%] truncate text-text-secondary" title={props.label}>
        {props.label}
      </span>
      <div class="flex-1 h-2 bg-bg-surfaceStrong rounded-sm overflow-hidden border border-border-subtle">
        <div
          class="h-full bg-accent/70"
          style={{ width: `${pct()}%` }}
        />
      </div>
      <span class="w-10 text-right font-mono tabular-nums text-text-primary">
        {props.turns}
      </span>
    </li>
  );
}

// ─── Small primitives ────────────────────────────────────────────────

function SectionHeader(props: { label: string }) {
  return (
    <div class="text-[10px] uppercase tracking-[0.18em] text-text-muted font-sans font-medium">
      {props.label}
    </div>
  );
}

function Counter(props: { label: string; v: number; warn: boolean }) {
  return (
    <div class="flex items-center justify-between gap-1">
      <span class="text-text-muted">{props.label}</span>
      <span
        class={`font-mono tabular-nums ${
          props.warn ? "text-danger" : "text-text-secondary"
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
      <span class="text-text-muted">{props.k}</span>
      <span class="font-mono tabular-nums text-text-primary">{props.v}</span>
    </div>
  );
}

// ─── Formatting helpers ──────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

/** Shorten a session label for the bar chart row. */
function sessionLabel(s: SessionMeta): string {
  // Prefer a human-readable title if one exists; otherwise fall back to the
  // short id prefix. Keeps the bar rows tidy on mobile.
  const raw = s.title ?? s.id;
  if (raw.length > 28) return `${raw.slice(0, 26)}…`;
  return raw || s.id.slice(0, 8);
}

// Keep `For` referenced even when the compiler aggressively tree-shakes it.
void For;
