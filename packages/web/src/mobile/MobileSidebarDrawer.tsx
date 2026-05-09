import { Show, type JSX } from "solid-js";

interface Props {
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
}

export function MobileSidebarDrawer(props: Props) {
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-40"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={props.onClose}
        />
        <aside
          class="absolute left-0 top-0 bottom-0 w-[min(320px,85vw)] bg-zinc-950 border-r border-zinc-900 shadow-2xl flex flex-col overflow-hidden animate-slide-in-left"
          style={{
            "padding-top": "env(safe-area-inset-top)",
            "padding-bottom": "env(safe-area-inset-bottom)",
          }}
        >
          {props.children}
        </aside>
      </div>
    </Show>
  );
}
