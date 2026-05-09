import { Show, splitProps, type JSX } from "solid-js";

/**
 * EmptyState — large empty placeholder for lists / panes with no content.
 * Centered flex column with generous vertical padding. Title uses the
 * serif display font to match the chat surface, not UI sans.
 */

export interface EmptyStateProps extends JSX.HTMLAttributes<HTMLDivElement> {
  icon?: JSX.Element | string;
  title: string;
  description?: string;
  action?: JSX.Element;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "icon",
    "title",
    "description",
    "action",
    "class",
  ]);

  return (
    <div
      {...rest}
      class={[
        "flex flex-col items-center justify-center text-center",
        "px-6 py-12 md:py-16 gap-4",
        local.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Show when={local.icon}>
        <div
          class={[
            "w-12 h-12 rounded-full flex items-center justify-center",
            "bg-bg-surfaceStrong text-text-secondary text-2xl leading-none",
          ].join(" ")}
          aria-hidden="true"
        >
          {local.icon}
        </div>
      </Show>
      <h3 class="font-serif text-lg md:text-xl text-text-primary m-0 font-medium">
        {local.title}
      </h3>
      <Show when={local.description}>
        <p class="text-sm text-text-secondary max-w-md m-0 leading-relaxed">
          {local.description}
        </p>
      </Show>
      <Show when={local.action}>
        <div class="mt-2">{local.action}</div>
      </Show>
    </div>
  );
}

export default EmptyState;
