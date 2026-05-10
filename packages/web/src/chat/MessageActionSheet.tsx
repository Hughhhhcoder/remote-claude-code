import { For, type JSX } from "solid-js";
import { Dialog } from "../primitives/Dialog";

/**
 * MessageActionSheet — mobile bottom-sheet action list opened via long-press
 * on a MessageRow (batch 26-A).
 *
 * Desktop users get the hover action toolbar on MessageRow; mobile (< 640px)
 * has no hover state so we surface the same actions in a Dialog (bottom sheet
 * presentation). Actions are rendered as `role="menuitem"` buttons inside a
 * `role="menu"` list for assistive-tech parity with the desktop toolbar.
 */

export interface MessageAction {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}

export interface MessageActionSheetProps {
  open: boolean;
  onClose: () => void;
  actions: readonly MessageAction[];
  title?: string;
}

export function MessageActionSheet(props: MessageActionSheetProps): JSX.Element {
  const handleSelect = (a: MessageAction): void => {
    if (a.disabled) return;
    a.onSelect();
    props.onClose();
  };
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={props.title ?? "消息操作"}
      size="sm"
    >
      <ul class="flex flex-col gap-1 -mx-1" role="menu">
        <For each={props.actions}>
          {(a) => (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => handleSelect(a)}
                disabled={a.disabled}
                aria-disabled={a.disabled ? "true" : "false"}
                class={[
                  "w-full flex items-center gap-3 rounded-md px-3 py-3 text-left",
                  "font-sans text-[15px] leading-tight",
                  "border border-transparent",
                  a.disabled
                    ? "opacity-40 cursor-not-allowed text-text-muted"
                    : "text-text-primary hover:bg-bg-surfaceStrong active:bg-bg-surfaceStrong",
                  a.tone === "danger" && !a.disabled ? "text-danger" : "",
                ].join(" ")}
              >
                <span aria-hidden="true" class="w-5 text-center text-[16px]">
                  {a.icon}
                </span>
                <span class="flex-1">{a.label}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Dialog>
  );
}

export default MessageActionSheet;
