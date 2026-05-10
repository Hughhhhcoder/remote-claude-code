import type { JSX } from "solid-js";

/**
 * AttachButton — triggers the ContextInjector overlay. Stateless; the
 * parent owns overlay mount and the heavy props (client, activeSid,
 * sessions, onClose). This button only reports the click intent.
 */

export interface AttachButtonProps {
  /** Called when user clicks — parent opens the inject overlay. */
  onClick: () => void;
  /** When disabled, renders inert. */
  disabled?: boolean;
  /** Optional tooltip override. */
  title?: string;
}

const BASE_CLASSES =
  "h-11 w-11 sm:h-9 sm:w-9 rounded-full inline-flex items-center justify-center " +
  "bg-transparent text-text-muted " +
  "hover:bg-bg-surfaceStrong hover:text-text-primary " +
  "transition duration-fast ease-rcc " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function AttachButton(props: AttachButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class={BASE_CLASSES}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
      disabled={props.disabled}
      aria-label="附加上下文"
      title={props.title ?? "附加上下文"}
    >
      <span class="font-sans text-[18px] leading-none" aria-hidden="true">+</span>
    </button>
  );
}

export default AttachButton;
