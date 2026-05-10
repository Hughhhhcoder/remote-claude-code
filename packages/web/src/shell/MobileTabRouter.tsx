import { lazy, Show, Suspense, type JSX } from "solid-js";
import type { RccClient } from "../client.ts";
import type { MobileTab } from "../stores/uiStore.ts";
import { ApprovalPane } from "../approvals/ApprovalPane.tsx";
import { MobileSettingsPane } from "./MobileSettingsPane.tsx";
import type { createPrefsStore } from "../prefs.ts";

const FileBrowser = lazy(() =>
  import("../FileBrowser.tsx").then((m) => ({ default: m.FileBrowser })),
);

/**
 * MobileTabRouter — routes the 4 bottom-tab values to their corresponding
 * full-screen panes on compact layouts (<1024px). Desktop never mounts this;
 * there the sidebar has direct affordances and a single ChatSurface fills
 * main. On mobile the tab bar is the primary nav so each tab owns the whole
 * main region.
 *
 * chat      → props.chat (parent supplies the full MainPane/EmptyState tree)
 * files     → FileBrowser rooted at the active session cwd (or fallback root)
 * approvals → ApprovalPane with full history
 * settings  → MobileSettingsPane (links out to existing modals)
 */

export interface MobileTabRouterProps {
  tab: () => MobileTab;
  client: RccClient;
  activeSessionCwd: () => string | undefined;
  fallbackCwd: () => string;
  chat: JSX.Element;
  prefs: ReturnType<typeof createPrefsStore>;
  onOpenConfig: () => void;
  onOpenDevices: () => void;
  onOpenPeers: () => void;
  onOpenInbox: () => void;
  onSignOut: () => void;
  currentDeviceName: () => string | null;
  tunnelUrl: () => string | null;
  pendingApprovals: () => number;
}

export function MobileTabRouter(props: MobileTabRouterProps): JSX.Element {
  return (
    <>
      <Show when={props.tab() === "chat"}>{props.chat}</Show>
      <Show when={props.tab() === "files"}>
        <div class="h-full min-h-0 overflow-y-auto bg-bg-page p-3">
          <Suspense
            fallback={
              <div class="text-text-muted text-sm py-8 text-center">加载文件浏览器...</div>
            }
          >
            <FileBrowser
              client={props.client}
              rootCwd={props.activeSessionCwd() ?? props.fallbackCwd()}
            />
          </Suspense>
        </div>
      </Show>
      <Show when={props.tab() === "approvals"}>
        <div class="h-full min-h-0 overflow-y-auto bg-bg-page">
          <ApprovalPane client={props.client} />
        </div>
      </Show>
      <Show when={props.tab() === "settings"}>
        <div class="h-full min-h-0 overflow-y-auto bg-bg-page">
          <MobileSettingsPane
            prefs={props.prefs}
            onOpenConfig={props.onOpenConfig}
            onOpenDevices={props.onOpenDevices}
            onOpenPeers={props.onOpenPeers}
            onOpenInbox={props.onOpenInbox}
            onSignOut={props.onSignOut}
            currentDeviceName={props.currentDeviceName}
            tunnelUrl={props.tunnelUrl}
            pendingApprovals={props.pendingApprovals}
          />
        </div>
      </Show>
    </>
  );
}
