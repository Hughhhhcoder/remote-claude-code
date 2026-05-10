import { createSignal, onCleanup, onMount } from "solid-js";

export function useVisualViewportBottom(): () => number {
  const [offset, setOffset] = createSignal(0);

  // [B19-C] rAF-coalesce resize/scroll: iOS fires these at high frequency
  // while the soft keyboard animates; raw handler caused layout thrash.
  let rafId: number | null = null;

  function compute() {
    rafId = null;
    const vv = window.visualViewport;
    if (!vv) {
      setOffset(0);
      return;
    }
    const gap = window.innerHeight - (vv.height + vv.offsetTop);
    setOffset(gap > 1 ? gap : 0);
  }

  function sync() {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(compute);
    } else {
      // SSR / test fallback.
      rafId = (setTimeout(compute, 16) as unknown) as number;
    }
  }

  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    compute();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    onCleanup(() => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
        rafId = null;
      }
    });
  });

  return offset;
}
