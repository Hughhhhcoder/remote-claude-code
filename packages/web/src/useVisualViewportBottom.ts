import { createSignal, onCleanup, onMount } from "solid-js";

export function useVisualViewportBottom(): () => number {
  const [offset, setOffset] = createSignal(0);

  function sync() {
    const vv = window.visualViewport;
    if (!vv) {
      setOffset(0);
      return;
    }
    const gap = window.innerHeight - (vv.height + vv.offsetTop);
    setOffset(gap > 1 ? gap : 0);
  }

  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    onCleanup(() => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    });
  });

  return offset;
}
