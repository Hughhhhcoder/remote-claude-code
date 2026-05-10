import { createMemo, Show, type JSX } from "solid-js";

/**
 * Sparkline — hand-rolled inline-SVG line chart for metric cards.
 *
 * No chart library. Tone maps to the locked design tokens
 * (accent / success / warn / danger / muted). The component is intentionally
 * tiny: give it an array of numbers and a pixel height; it figures out the
 * viewBox, normalization and path. The SVG stretches to fill its parent's
 * width so callers just wrap it in a flex/grid cell.
 *
 * Two visual layers are rendered when there is data:
 *   1. A soft filled area (current tone at ~18% alpha)
 *   2. A 1.25px stroke line (current tone at full alpha)
 *   3. An optional last-point dot, to anchor the "now" reading.
 *
 * When `points` is empty or has <2 samples we render a centered dashed
 * baseline so the card doesn't collapse or show an empty box.
 */

export type SparklineTone =
  | "accent"
  | "success"
  | "warn"
  | "danger"
  | "muted";

export interface SparklineProps {
  points: number[];
  /** Visual height in px. Width tracks the container. Default 32. */
  height?: number;
  /** Color role. Maps to css variable. Default "accent". */
  tone?: SparklineTone;
  /** Override the max for normalization. Defaults to max(points, 1). */
  max?: number;
  /** Override the min. Defaults to 0 (typical for rate-style metrics). */
  min?: number;
  /** Show a small dot at the most recent sample. Default true. */
  showLastDot?: boolean;
  /** Extra class hooks (spacing, margins, etc.). */
  class?: string;
  /** Accessible label for screen readers. */
  label?: string;
}

/**
 * rgb(var(--token)) — tone → css variable mapping.
 * Kept here rather than in tailwind so we can set SVG `stroke`/`fill`
 * via `var(...)` without hardcoding hex values that would drift from
 * the token file.
 */
const TONE_VAR: Record<SparklineTone, string> = {
  accent: "rgb(var(--accent))",
  success: "rgb(var(--success))",
  warn: "rgb(var(--warn))",
  danger: "rgb(var(--danger))",
  muted: "rgb(var(--text-muted))",
};

/** rgb(var(--token) / <alpha>) — same mapping but with a lower alpha for fills. */
function toneFillVar(tone: SparklineTone): string {
  switch (tone) {
    case "accent":
      return "rgb(var(--accent) / 0.18)";
    case "success":
      return "rgb(var(--success) / 0.18)";
    case "warn":
      return "rgb(var(--warn) / 0.18)";
    case "danger":
      return "rgb(var(--danger) / 0.18)";
    case "muted":
      return "rgb(var(--text-muted) / 0.18)";
  }
}

const VIEW_W = 120;

/**
 * SparklineSVG — the primitive. Consumers render it inline inside a card:
 *
 *   <SparklineSVG points={series} tone="accent" />
 */
export function SparklineSVG(props: SparklineProps): JSX.Element {
  const height = () => props.height ?? 32;
  const tone = () => props.tone ?? "accent";

  const paths = createMemo<{ line: string; area: string; lastX: number; lastY: number } | null>(() => {
    const pts = props.points;
    if (!pts || pts.length < 2) return null;

    const h = height();
    const w = VIEW_W;

    // Normalization bounds. Callers can override; otherwise we clamp the
    // minimum to 0 so a flat-zero series sits along the bottom edge
    // (standard rate-style look) rather than the middle.
    const rawMax = props.max ?? pts.reduce((a, b) => (b > a ? b : a), 1);
    const rawMin = props.min ?? 0;
    const max = rawMax > rawMin ? rawMax : rawMin + 1;
    const range = max - rawMin;

    const step = w / (pts.length - 1);

    let line = "";
    let area = "";
    let lastX = 0;
    let lastY = h;

    for (let i = 0; i < pts.length; i++) {
      const v = pts[i]!;
      const clamped = Math.min(Math.max(v, rawMin), max);
      const x = i * step;
      // Leave a 1px top/bottom margin so the stroke doesn't get clipped.
      const y = h - 1 - ((clamped - rawMin) / range) * (h - 2);
      line += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
      if (i === 0) area = `M${x.toFixed(1)},${h} L${x.toFixed(1)},${y.toFixed(1)} `;
      else area += `L${x.toFixed(1)},${y.toFixed(1)} `;
      lastX = x;
      lastY = y;
    }
    area += `L${lastX.toFixed(1)},${h} Z`;
    return { line: line.trim(), area: area.trim(), lastX, lastY };
  });

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height()}`}
      class={`w-full block ${props.class ?? ""}`}
      style={{ height: `${height()}px` }}
      preserveAspectRatio="none"
      role="img"
      aria-label={props.label ?? "sparkline"}
    >
      <Show
        when={paths()}
        fallback={
          // Empty / single-point fallback: dashed baseline so the card
          // still has visual rhythm even before data arrives.
          <line
            x1="0"
            y1={height() / 2}
            x2={VIEW_W}
            y2={height() / 2}
            stroke="rgb(var(--border-subtle))"
            stroke-width="1"
            stroke-dasharray="2 3"
          />
        }
      >
        {(data) => (
          <>
            <path d={data().area} fill={toneFillVar(tone())} stroke="none" />
            <path
              d={data().line}
              fill="none"
              stroke={TONE_VAR[tone()]}
              stroke-width="1.25"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
            <Show when={props.showLastDot !== false}>
              <circle
                cx={data().lastX}
                cy={data().lastY}
                r="1.75"
                fill={TONE_VAR[tone()]}
                vector-effect="non-scaling-stroke"
              />
            </Show>
          </>
        )}
      </Show>
    </svg>
  );
}

export default SparklineSVG;
