import { createSignal } from "solid-js";
import type { RccClient } from "../client.ts";
import type { MobileTab } from "../mobile/MobileTabNav.tsx";

/**
 * UI-layer signals (modals, drawers, panes, active mobile tab, view mode).
 *
 * Pure local state — no ws frame handling. The `client` arg is accepted for
 * symmetry with sibling stores and to leave a seam for future UI-driven
 * frames (e.g. remembering the last-opened pane on the host). It's
 * intentionally unused today.
 */
export interface UiStore {
  // Modal open flags
  modalOpen: () => boolean;
  setModalOpen: (v: boolean) => void;
  devicesOpen: () => boolean;
  setDevicesOpen: (v: boolean) => void;
  configOpen: () => boolean;
  setConfigOpen: (v: boolean) => void;
  marketOpen: () => boolean;
  setMarketOpen: (v: boolean) => void;
  projectsModalOpen: () => boolean;
  setProjectsModalOpen: (v: boolean) => void;
  peersModalOpen: () => boolean;
  setPeersModalOpen: (v: boolean) => void;
  newProjectOpen: () => boolean;
  setNewProjectOpen: (v: boolean) => void;
  settingsOpen: () => boolean;
  setSettingsOpen: (v: boolean) => void;
  shareOpen: () => boolean;
  setShareOpen: (v: boolean) => void;
  inboxOpen: () => boolean;
  setInboxOpen: (v: boolean) => void;

  // Main pane toggles
  fileBrowserOpen: () => boolean;
  setFileBrowserOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  notebookOpen: () => boolean;
  setNotebookOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  fileBrowserRoot: () => string;
  setFileBrowserRoot: (v: string) => void;

  // Share target
  shareSid: () => string | null;
  setShareSid: (v: string | null) => void;

  // v0.2 additions
  mobileTab: () => MobileTab;
  setMobileTab: (v: MobileTab) => void;
  drawerOpen: () => boolean;
  setDrawerOpen: (v: boolean) => void;

  // View mode (chat fallback vs raw xterm)
  viewMode: () => "chat" | "terminal";
  setViewMode: (v: "chat" | "terminal" | ((prev: "chat" | "terminal") => "chat" | "terminal")) => void;

  // Convenience
  openShare: (sid: string) => void;

  dispose: () => void;
}

export interface CreateUiStoreOptions {
  /** initial mobileTab (default "chat") */
  initialMobileTab?: MobileTab;
  /** initial viewMode (default "terminal" on desktop, caller decides) */
  initialViewMode?: "chat" | "terminal";
}

export function createUiStore(
  _client: RccClient,
  opts: CreateUiStoreOptions = {},
): UiStore {
  const [modalOpen, setModalOpen] = createSignal(false);
  const [devicesOpen, setDevicesOpen] = createSignal(false);
  const [configOpen, setConfigOpen] = createSignal(false);
  const [marketOpen, setMarketOpen] = createSignal(false);
  const [projectsModalOpen, setProjectsModalOpen] = createSignal(false);
  const [peersModalOpen, setPeersModalOpen] = createSignal(false);
  const [newProjectOpen, setNewProjectOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [shareOpen, setShareOpen] = createSignal(false);
  const [inboxOpen, setInboxOpen] = createSignal(false);

  const [fileBrowserOpen, setFileBrowserOpen] = createSignal(false);
  const [notebookOpen, setNotebookOpen] = createSignal(false);
  const [fileBrowserRoot, setFileBrowserRoot] = createSignal<string>("~");

  const [shareSid, setShareSid] = createSignal<string | null>(null);

  const [mobileTab, setMobileTab] = createSignal<MobileTab>(opts.initialMobileTab ?? "chat");
  const [drawerOpen, setDrawerOpen] = createSignal(false);

  const [viewMode, setViewMode] = createSignal<"chat" | "terminal">(
    opts.initialViewMode ?? "terminal",
  );

  function openShare(sid: string): void {
    setShareSid(sid);
    setShareOpen(true);
  }

  return {
    modalOpen,
    setModalOpen,
    devicesOpen,
    setDevicesOpen,
    configOpen,
    setConfigOpen,
    marketOpen,
    setMarketOpen,
    projectsModalOpen,
    setProjectsModalOpen,
    peersModalOpen,
    setPeersModalOpen,
    newProjectOpen,
    setNewProjectOpen,
    settingsOpen,
    setSettingsOpen,
    shareOpen,
    setShareOpen,
    inboxOpen,
    setInboxOpen,
    fileBrowserOpen,
    setFileBrowserOpen,
    notebookOpen,
    setNotebookOpen,
    fileBrowserRoot,
    setFileBrowserRoot,
    shareSid,
    setShareSid,
    mobileTab,
    setMobileTab,
    drawerOpen,
    setDrawerOpen,
    viewMode,
    setViewMode,
    openShare,
    dispose: () => {
      // no subscriptions to release
    },
  };
}
