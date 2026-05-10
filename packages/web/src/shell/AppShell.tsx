import {
  Show,
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import { Dialog } from "../primitives/Dialog";
import { useIsCompact, useIsMobile } from "../hooks/useMediaQuery";

/**
 * AppShell — Phase 2-A responsive frame for RCC v0.2.
 *
 * Three modes driven by two CSS media queries (single JS source of truth):
 *
 *   Desktop   (>= 1024px) : 2-col grid [300px sidebar | main], TabNav off,
 *                            TopBar normal (shrink-0, above grid).
 *   Tablet    (640-1023)  : sidebar renders inside <Dialog>, TabNav fixed
 *                            bottom (reserved via padding on main), TopBar
 *                            normal. Dialog's desktop branch kicks in at
 *                            >=640 so the drawer appears as a centred card.
 *   Phone     (< 640px)   : same as tablet, plus TopBar becomes sticky/
 *                            blurred and the <Dialog> slides up from the
 *                            bottom (see compromise note below).
 *
 * Compromise (v1): Dialog's mobile branch is a bottom sheet. We accept that
 * for the sidebar drawer at <640px instead of extending Dialog with a
 * left-sheet variant. Tablet (641-1023) uses the centred-card form which
 * reads fine for a sidebar.
 */

// ---------------------------------------------------------------------------
// Context — lets descendants (e.g. a menu button in TopBar) toggle the drawer
// without prop-drilling. Optional: AppShell also accepts an explicit
// `drawer` prop, which takes precedence when provided.
// ---------------------------------------------------------------------------

interface AppShellContextValue {
  isCompact: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  drawerOpen: Accessor<boolean>;
  setDrawerOpen: (open: boolean) => void;
}

const AppShellContext = createContext<AppShellContextValue>();

/** Read AppShell's responsive + drawer state from any descendant. */
export function useAppShell(): AppShellContextValue {
  const ctx = useContext(AppShellContext);
  if (!ctx) {
    throw new Error("useAppShell must be used inside <AppShell>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AppShellProps {
  /** Left navigation. Inline on desktop, inside a Dialog when compact. */
  sidebar: JSX.Element;
  /** Global top bar. Always rendered at the top of the viewport. */
  topBar: JSX.Element;
  /** Optional bottom tab navigation. Only mounted on compact layouts. */
  tabNav?: JSX.Element;
  /** Optional connection-status banner. Rendered between TopBar and main
   * content at all breakpoints. Unmounted entirely on the happy path. */
  connectionBanner?: JSX.Element;
  /** Main pane content. */
  children: JSX.Element;
  /**
   * External drawer control. Optional — if omitted, AppShell manages the
   * state internally and exposes it via `useAppShell()`.
   */
  drawer?: { open: boolean; onClose: () => void };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Reserve space for the fixed bottom tab nav on compact layouts. */
const TAB_NAV_PAD_CLASS =
  "pb-[calc(56px+env(safe-area-inset-bottom))]";

export function AppShell(props: AppShellProps): JSX.Element {
  const isCompact = useIsCompact();
  const isMobile = useIsMobile();

  // Internal drawer state — used when `props.drawer` is not provided.
  const [internalOpen, setInternalOpen] = createSignal(false);

  const drawerOpen = () => props.drawer?.open ?? internalOpen();
  const setDrawerOpen = (open: boolean) => {
    if (props.drawer) {
      if (!open) props.drawer.onClose();
      // If caller passed a drawer prop, opening is their responsibility.
      return;
    }
    setInternalOpen(open);
  };
  const closeDrawer = () => setDrawerOpen(false);

  const ctx: AppShellContextValue = {
    isCompact,
    isMobile,
    drawerOpen,
    setDrawerOpen,
  };

  return (
    <AppShellContext.Provider value={ctx}>
      <div class="h-[100svh] flex flex-col bg-bg-page text-text-primary">
        {/* ----- TopBar ---------------------------------------------------
            Sticky on mobile so scrolling main content keeps chrome visible.
            On >=640 it's just shrink-0 at the top of the flex column. */}
        <header
          class={[
            "shrink-0 z-30",
            isMobile()
              ? "sticky top-0 bg-bg-page/95 backdrop-blur"
              : "",
          ].join(" ")}
        >
          {props.topBar}
        </header>

        {/* ----- Connection banner ---------------------------------------
            Slim strip between TopBar and main content. Unmounted on the
            happy path; on mobile it stays sticky-below-TopBar naturally
            because TopBar is the one with `sticky top-0`. */}
        <Show when={props.connectionBanner}>
          <div class="shrink-0 z-20">{props.connectionBanner}</div>
        </Show>

        {/* ----- Main region ----------------------------------------------
            Desktop : grid [sidebar | content]
            Compact : just content full-width; sidebar lives in Dialog. */}
        <Show
          when={!isCompact()}
          fallback={
            <main
              class={[
                "flex-1 min-h-0 overflow-y-auto",
                props.tabNav ? TAB_NAV_PAD_CLASS : "",
              ].join(" ")}
            >
              {props.children}
            </main>
          }
        >
          <div class="flex-1 min-h-0 grid grid-cols-[300px_1fr]">
            <aside class="min-h-0 overflow-y-auto border-r border-border-subtle bg-bg-surface">
              {props.sidebar}
            </aside>
            <main class="min-h-0 overflow-y-auto">{props.children}</main>
          </div>
        </Show>

        {/* ----- Bottom TabNav -------------------------------------------
            Compact only; fixed at the bottom with safe-area padding.
            Main pane reserves the same space via TAB_NAV_PAD_CLASS above. */}
        <Show when={isCompact() && props.tabNav}>
          <nav
            class="fixed bottom-0 inset-x-0 z-30 bg-bg-surface border-t border-border-subtle"
            style={{ "padding-bottom": "env(safe-area-inset-bottom)" }}
          >
            {props.tabNav}
          </nav>
        </Show>

        {/* ----- Sidebar drawer ------------------------------------------
            Only mounted when compact; Dialog handles its own Portal /
            backdrop / focus trap / ESC-to-close. On phone it slides up
            from the bottom; on tablet it appears as a centred card. */}
        <Show when={isCompact()}>
          <Dialog open={drawerOpen()} onClose={closeDrawer} size="sm">
            {props.sidebar}
          </Dialog>
        </Show>
      </div>
    </AppShellContext.Provider>
  );
}

export default AppShell;
