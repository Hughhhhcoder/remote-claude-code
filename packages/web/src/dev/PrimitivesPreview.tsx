import { createSignal, For, type JSX } from "solid-js";
import { useTheme, type Theme } from "../tokens/theme";
import { Button } from "../primitives/Button";
import { IconButton } from "../primitives/IconButton";
import { Chip } from "../primitives/Chip";
import { Card } from "../primitives/Card";
import { TextInput } from "../primitives/TextInput";
import { Textarea } from "../primitives/Textarea";
import { Toggle } from "../primitives/Toggle";
import { KeyHint } from "../primitives/KeyHint";
import { Dialog } from "../primitives/Dialog";
import { Popover } from "../primitives/Popover";
import { Spinner } from "../primitives/Spinner";
import { EmptyState } from "../primitives/EmptyState";

/**
 * /dev/primitives — gallery route for Phase 1 design primitives.
 *
 * Verifies that every primitive from P1-B/C/D renders correctly in both
 * light and dark themes at desktop and mobile widths. This is a dev-only
 * preview; no feature code depends on it.
 */

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="flex flex-col gap-4 py-8 border-b border-border-subtle last:border-b-0">
      <h2 class="font-sans text-sm font-medium uppercase tracking-[0.14em] text-text-muted m-0">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function Row(props: { label?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-col gap-2">
      {props.label ? (
        <span class="font-sans text-[11px] uppercase tracking-widest text-text-muted">
          {props.label}
        </span>
      ) : null}
      <div class="flex flex-wrap items-center gap-3">{props.children}</div>
    </div>
  );
}

const THEMES: readonly Theme[] = ["light", "dark", "system"] as const;

export function PrimitivesPreview(): JSX.Element {
  const { theme, setTheme, effective } = useTheme();

  // Controlled state for interactive demos.
  const [inputValue, setInputValue] = createSignal("hello");
  const [inputError, setInputError] = createSignal("");
  const [textareaValue, setTextareaValue] = createSignal(
    "Type across multiple lines — this textarea auto-grows up to 8 rows.",
  );
  const [toggle1, setToggle1] = createSignal(true);
  const [toggle2, setToggle2] = createSignal(false);

  const [dialogOpen, setDialogOpen] = createSignal(false);

  // Popover anchor + state.
  let popoverAnchor: HTMLButtonElement | undefined;
  const [popoverOpen, setPopoverOpen] = createSignal(false);

  return (
    <div class="min-h-dvh bg-bg-page text-text-primary">
      <div class="max-w-[1120px] mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Header */}
        <header class="flex flex-col gap-4 pb-6 border-b border-border-subtle">
          <h1 class="font-serif text-2xl sm:text-3xl text-text-primary m-0 font-medium">
            RCC · Primitives Preview
          </h1>
          <p class="font-serif text-base text-text-secondary m-0 leading-[1.65] max-w-[640px]">
            Phase 1 design primitives, rendered in the currently selected
            theme. Toggle below to flip palettes and verify at mobile width.
          </p>

          <div class="flex flex-wrap items-center gap-3">
            <span class="font-sans text-[11px] uppercase tracking-widest text-text-muted">
              Theme
            </span>
            <div class="inline-flex rounded-md border border-border-subtle bg-bg-surface overflow-hidden">
              <For each={THEMES}>
                {(t) => (
                  <button
                    type="button"
                    onClick={() => setTheme(t)}
                    class={[
                      "font-sans text-sm px-3 h-9 transition duration-fast ease-rcc",
                      "border-r border-border-subtle last:border-r-0",
                      theme() === t
                        ? "bg-accent-bg text-accent font-medium"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-surfaceStrong",
                    ].join(" ")}
                  >
                    {t}
                  </button>
                )}
              </For>
            </div>
            <Chip tone="accent" dot>
              effective: {effective()}
            </Chip>
          </div>
        </header>

        {/* Responsive grid: single column on mobile, 2 cols at md+ */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-10">
          <Section title="Buttons">
            <Row label="Primary">
              <Button variant="primary" size="sm">
                Small
              </Button>
              <Button variant="primary" size="md">
                Medium
              </Button>
              <Button variant="primary" size="lg">
                Large
              </Button>
            </Row>
            <Row label="Secondary">
              <Button variant="secondary" size="sm">
                Small
              </Button>
              <Button variant="secondary" size="md">
                Medium
              </Button>
              <Button variant="secondary" size="lg">
                Large
              </Button>
            </Row>
            <Row label="Ghost">
              <Button variant="ghost" size="sm">
                Small
              </Button>
              <Button variant="ghost" size="md">
                Medium
              </Button>
              <Button variant="ghost" size="lg">
                Large
              </Button>
            </Row>
            <Row label="Danger / states">
              <Button variant="danger">Delete</Button>
              <Button variant="primary" loading>
                Saving
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </Row>
          </Section>

          <Section title="Icon buttons">
            <Row label="Sizes">
              <IconButton aria-label="Search" size="sm">
                ⌕
              </IconButton>
              <IconButton aria-label="Search" size="md">
                ⌕
              </IconButton>
              <IconButton aria-label="Search" size="lg">
                ⌕
              </IconButton>
            </Row>
            <Row label="Tones">
              <IconButton aria-label="Info" tone="default">
                ⋯
              </IconButton>
              <IconButton aria-label="Favorite" tone="accent">
                ★
              </IconButton>
              <IconButton aria-label="Delete" tone="danger">
                ✕
              </IconButton>
            </Row>
          </Section>

          <Section title="Chips">
            <Row label="Tones">
              <Chip tone="neutral">neutral</Chip>
              <Chip tone="accent">accent</Chip>
              <Chip tone="success">success</Chip>
              <Chip tone="warn">warn</Chip>
              <Chip tone="danger">danger</Chip>
              <Chip tone="info">info</Chip>
            </Row>
            <Row label="With dot">
              <Chip tone="success" dot>
                connected
              </Chip>
              <Chip tone="warn" dot>
                reconnecting
              </Chip>
              <Chip tone="danger" dot>
                offline
              </Chip>
              <Chip tone="neutral" dot size="xs">
                xs
              </Chip>
            </Row>
          </Section>

          <Section title="Cards">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card padding="sm">
                <div class="font-sans text-xs uppercase tracking-widest text-text-muted mb-1">
                  Card · sm
                </div>
                <p class="font-serif text-sm text-text-primary m-0 leading-[1.65]">
                  A compact card with subtle border and surface tint.
                </p>
              </Card>
              <Card padding="md" interactive>
                <div class="font-sans text-xs uppercase tracking-widest text-text-muted mb-1">
                  Card · interactive
                </div>
                <p class="font-serif text-sm text-text-primary m-0 leading-[1.65]">
                  Hover me — background deepens, border strengthens.
                </p>
              </Card>
              <Card padding="lg" class="sm:col-span-2">
                <div class="font-sans text-xs uppercase tracking-widest text-text-muted mb-1">
                  Card · lg
                </div>
                <p class="font-serif text-[15px] text-text-primary m-0 leading-[1.65]">
                  Roomier padding for content-heavy cards — think session
                  detail panes or onboarding callouts. Body text is serif to
                  match the chat surface.
                </p>
              </Card>
            </div>
          </Section>

          <Section title="Text input · Textarea">
            <TextInput
              label="Project name"
              hint="Human-readable; appears in the sidebar."
              value={inputValue()}
              onInput={(v) => {
                setInputValue(v);
                setInputError(v.trim().length === 0 ? "Required" : "");
              }}
              placeholder="e.g. claude-app"
            />
            <TextInput
              label="Error example"
              error="That name is taken."
              value="taken-name"
              onInput={() => {}}
            />
            <Textarea
              label="Description"
              hint="Enter submits; Shift+Enter inserts a newline."
              value={textareaValue()}
              onInput={setTextareaValue}
              onEnter={() => {
                /* dev-only */
              }}
              maxRows={6}
              placeholder="Tell us about this project…"
            />
          </Section>

          <Section title="Toggle">
            <Row>
              <Toggle
                checked={toggle1()}
                onChange={setToggle1}
                label="Notifications"
              />
              <Toggle
                checked={toggle2()}
                onChange={setToggle2}
                label="Experimental features"
              />
              <Toggle
                checked={false}
                onChange={() => {}}
                label="Disabled"
                disabled
              />
            </Row>
            <Row label="Without label">
              <Toggle
                checked={toggle1()}
                onChange={setToggle1}
                aria-label="Bare toggle"
              />
            </Row>
          </Section>

          <Section title="Key hints">
            <Row>
              <span class="font-serif text-sm text-text-secondary">
                Command palette
              </span>
              <KeyHint keys={["⌘", "K"]} />
            </Row>
            <Row>
              <span class="font-serif text-sm text-text-secondary">
                Submit
              </span>
              <KeyHint keys={["Enter"]} size="md" />
            </Row>
            <Row>
              <span class="font-serif text-sm text-text-secondary">
                New line
              </span>
              <KeyHint keys={["Shift", "Enter"]} />
            </Row>
          </Section>

          <Section title="Dialog">
            <Row>
              <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
              <span class="font-serif text-sm text-text-secondary">
                Mobile: bottom sheet. Desktop: centered modal.
              </span>
            </Row>
            <Dialog
              open={dialogOpen()}
              onClose={() => setDialogOpen(false)}
              title="Confirm deletion"
            >
              <p class="font-serif text-[15px] text-text-primary leading-[1.65] m-0 mb-4">
                Are you sure you want to delete this session? This cannot be
                undone. All associated messages and attachments will be
                removed from the local device.
              </p>
              <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setDialogOpen(false)}>
                  Delete
                </Button>
              </div>
            </Dialog>
          </Section>

          <Section title="Popover">
            <Row>
              <button
                ref={popoverAnchor}
                type="button"
                onClick={() => setPopoverOpen((v) => !v)}
                class="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-bg-surface border border-border-subtle font-sans text-sm text-text-primary hover:border-border-strong transition duration-fast ease-rcc"
              >
                Open popover
                <span class="text-text-muted">▾</span>
              </button>
              <span class="font-serif text-sm text-text-secondary">
                Mobile promotes to a bottom sheet automatically.
              </span>
            </Row>
            <Popover
              open={popoverOpen()}
              onClose={() => setPopoverOpen(false)}
              anchor={() => popoverAnchor}
              placement="bottom-start"
            >
              <div class="w-[240px] max-w-[90vw] p-2">
                <For
                  each={[
                    { label: "Rename", hint: ["R"] },
                    { label: "Duplicate", hint: ["⌘", "D"] },
                    { label: "Archive", hint: ["E"] },
                  ]}
                >
                  {(item) => (
                    <button
                      type="button"
                      class="w-full flex items-center justify-between gap-3 px-3 h-9 rounded-sm font-sans text-sm text-text-primary hover:bg-bg-surfaceStrong text-left"
                      onClick={() => setPopoverOpen(false)}
                    >
                      <span>{item.label}</span>
                      <KeyHint keys={item.hint} />
                    </button>
                  )}
                </For>
              </div>
            </Popover>
          </Section>

          <Section title="Spinner">
            <Row label="Sizes">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
            </Row>
            <Row label="Colors">
              <Spinner color="current" />
              <Spinner color="accent" />
              <Spinner color="muted" />
            </Row>
          </Section>

          <Section title="Empty state">
            <Card padding="sm">
              <EmptyState
                icon="✦"
                title="No sessions yet"
                description="Start a new session from the composer, or pair a device to receive one."
                action={<Button variant="primary">New session</Button>}
              />
            </Card>
          </Section>
        </div>

        <footer class="pt-6 pb-10 font-sans text-xs text-text-muted">
          RCC v0.2 · Phase 1 primitives · theme = {theme()} → {effective()}
        </footer>
      </div>
    </div>
  );
}

export default PrimitivesPreview;
