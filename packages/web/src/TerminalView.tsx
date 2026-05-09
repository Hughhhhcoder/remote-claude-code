import { onCleanup, onMount, createEffect } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Frame } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

interface Props {
  client: RccClient;
  sid: string;
}

/** Xterm-backed live terminal view bound to a single rcc session. */
export function TerminalView(props: Props) {
  let host!: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let unsubFrame: (() => void) | null = null;

  onMount(() => {
    term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: false,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#fb923c",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#3f3f46",
        black: "#18181b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      },
    });

    fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    // Push keystrokes → host.
    term.onData((data) => {
      props.client.write(props.sid, data);
    });

    // Forward incoming frames for this sid to the terminal.
    unsubFrame = props.client.on((frame: Frame) => {
      if (frame.t === "pty.out" && frame.sid === props.sid) {
        term!.write(frame.data);
      }
    });

    // Initial fit + resize sync.
    const doFit = () => {
      if (!fit || !term) return;
      try {
        fit.fit();
        props.client.resize(props.sid, term.cols, term.rows);
      } catch {
        // element not laid out yet
      }
    };
    setTimeout(doFit, 0);

    const ro = new ResizeObserver(doFit);
    ro.observe(host);

    // Make sure the session is attached.
    props.client.attach(props.sid);

    onCleanup(() => {
      ro.disconnect();
      unsubFrame?.();
      term?.dispose();
      term = null;
    });
  });

  // If sid changes, re-attach and clear screen.
  createEffect(() => {
    const sid = props.sid;
    if (!term) return;
    term.reset();
    props.client.attach(sid);
  });

  return <div ref={host} class="h-full w-full bg-[#09090b]" />;
}
