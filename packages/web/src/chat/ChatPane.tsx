import {
  createContext,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import type { ChatMessage, GitStatusData, SessionMeta } from "@rcc/protocol";
import { EmptyState } from "../primitives/EmptyState";
import { Textarea } from "../primitives/Textarea";
import { ChatHeader } from "./ChatHeader";

/**
 * ChatPane — top-level chat surface container (Phase 4-A).
 *
 * Composes three slots: header + scroll region + composer. Owns the
 * scrollable DIV that MessageList (P4-B) uses for autoscroll; exposes
 * sid + scroll ref via `ChatPaneContext` so descendants don't need
 * prop-drilling to reach them.
 *
 * Layout (column flex, full height):
 *   - ChatHeader      shrink-0, 48-56px, bottom border
 *   - Scroll region   flex-1 min-h-0 overflow-y-auto, content centered at 760px
 *   - Composer slot   shrink-0, top border, content centered at 760px
 *
 * Responsive: the 760px max-width applies at all breakpoints; on phones the
 * chat column simply hits the viewport edges via px-4. No md:only branches
 * for the outer structure, so the 375px hard-gate is trivially satisfied.
 */

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ChatPaneContextValue {
  sid: Accessor<string>;
  scrollEl: Accessor<HTMLDivElement | undefined>;
}

export const ChatPaneContext = createContext<ChatPaneContextValue>();

/**
 * Read the chat pane's sid + scroll element from any descendant.
 * Returns `undefined` when called outside a `<ChatPane>` — callers should
 * tolerate this (e.g. during unit tests that mount MessageList bare).
 */
export function useChatPane(): ChatPaneContextValue | undefined {
  return useContext(ChatPaneContext);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatPaneProps {
  sid: string;
  session: SessionMeta | undefined;
  /** Git status for the header's BranchChip. Optional. */
  gitStatus?: GitStatusData | null;
  /** Filled by P4-B via App wiring in batch 6. */
  messagesSlot?: JSX.Element;
  /** Filled by batch 6 Composer. */
  composerSlot?: JSX.Element;
  onShare?: () => void;
  onToggleNotebook?: () => void;
  notebookActive?: boolean;
  /** Desktop-only chat/terminal toggle. */
  onToggleViewMode?: () => void;
  viewMode?: "chat" | "terminal";
  /** [B28-A] Messages for the export dropdown in ChatHeader. Optional —
   *  callers that omit it lose the export button contents but keep chrome. */
  messages?: readonly ChatMessage[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatPane(props: ChatPaneProps): JSX.Element {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | undefined>(
    undefined,
  );

  const ctxValue: ChatPaneContextValue = {
    sid: () => props.sid,
    scrollEl,
  };

  onMount(() => {
    // Signal mount so the P4-B integrator can confirm wiring during batch 6.
    // eslint-disable-next-line no-console
    console.log("[ChatPane] mounted sid=", props.sid);
  });

  return (
    <ChatPaneContext.Provider value={ctxValue}>
      <div class="h-full flex flex-col bg-bg-page min-h-0">
        <ChatHeader
          session={props.session}
          gitStatus={props.gitStatus}
          viewMode={props.viewMode}
          onToggleViewMode={props.onToggleViewMode}
          onShare={props.onShare}
          onToggleNotebook={props.onToggleNotebook}
          notebookActive={props.notebookActive}
          messages={props.messages}
          sid={props.sid}
        />

        {/* Scroll region — the DIV itself scrolls; MessageList renders a */}
        {/* normal block inside and uses the scrollEl ref for autoscroll. */}
        <div
          ref={(el) => setScrollEl(el)}
          class="flex-1 min-h-0 overflow-y-auto"
          data-chat-scroll="true"
          role="region"
          aria-label="对话内容"
        >
          <div class="mx-auto max-w-[760px] w-full px-4 md:px-6 py-6">
            {props.messagesSlot ?? (
              <EmptyState
                title="暂无消息"
                description="发送第一条消息开始对话"
              />
            )}
          </div>
        </div>

        {/* Composer slot — border-t separator, same 760px centering. */}
        <div
          class="shrink-0 border-t border-border-subtle bg-bg-page"
          role="region"
          aria-label="消息输入"
        >
          <div class="mx-auto max-w-[760px] w-full px-4 py-3">
            {props.composerSlot ?? <PlaceholderComposer />}
          </div>
        </div>
      </div>
    </ChatPaneContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Placeholder composer — only visible before the real Composer (batch 6)
// is wired in. Keeps the layout complete so QA can review the pane shell
// at 375/1280 without having to mount a half-working chat.
// ---------------------------------------------------------------------------

function PlaceholderComposer(): JSX.Element {
  const [value, setValue] = createSignal("");
  return (
    <Textarea
      value={value()}
      onInput={setValue}
      placeholder="Composer (batch 6)…"
      rows={1}
      maxRows={6}
      aria-label="Message composer placeholder"
    />
  );
}

export default ChatPane;
