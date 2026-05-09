import { splitProps, type JSX } from "solid-js";

export interface ToggleProps
  extends Omit<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange" | "type" | "role" | "aria-checked"
  > {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

/**
 * iOS-style switch, built on a <button role="switch"> for native a11y.
 * Label is rendered side-by-side when provided.
 */
export function Toggle(props: ToggleProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "checked",
    "onChange",
    "label",
    "disabled",
    "class",
    "id",
  ]);

  const ctrlId =
    local.id ?? `tg-${Math.random().toString(36).slice(2, 9)}`;

  const track = () =>
    [
      "relative inline-flex items-center w-9 h-5 rounded-full shrink-0",
      "transition-colors duration-[var(--duration-fast,150ms)] ease-rcc",
      "outline-none focus-visible:shadow-[0_0_0_3px_rgb(var(--accent)/0.25)]",
      local.checked ? "bg-accent" : "bg-bg-surfaceStrong",
      local.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
    ].join(" ");

  const thumb = () =>
    [
      "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow",
      "transition-transform duration-[var(--duration-fast,150ms)] ease-rcc",
      local.checked ? "translate-x-4" : "translate-x-0",
    ].join(" ");

  const button = (
    <button
      id={ctrlId}
      type="button"
      role="switch"
      aria-checked={local.checked}
      aria-label={rest["aria-label"] ?? local.label}
      disabled={local.disabled}
      {...rest}
      onClick={(e) => {
        // fire caller's onClick first if they wired one up
        const cb = (rest as { onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent> }).onClick;
        if (typeof cb === "function") cb(e);
        if (e.defaultPrevented || local.disabled) return;
        local.onChange(!local.checked);
      }}
      class={track()}
    >
      <span class={thumb()} />
    </button>
  );

  if (!local.label) {
    // Un-wrapped so class on the primitive flows to the button itself.
    return (
      <span class={local.class ?? ""}>
        {button}
      </span>
    );
  }

  return (
    <label
      for={ctrlId}
      class={`inline-flex items-center gap-2 font-sans text-sm text-text-primary ${
        local.disabled ? "opacity-60" : ""
      } ${local.class ?? ""}`}
    >
      {button}
      <span>{local.label}</span>
    </label>
  );
}

export default Toggle;
