import { createSignal, onCleanup, type JSX } from "solid-js";
import {
  startDictation,
  isSpeechSupported,
  hasMediaRecorder,
  errorMessage,
  type DictationHandle,
} from "../voice.ts";

/**
 * VoiceButton — toggles voice dictation. Stateless w.r.t. the composer
 * draft: reports lifecycle via `onStart` (snapshot draft) and streams voice
 * text via `onTranscript(text, isFinal)`. Mic is released on unmount via
 * `handle.cancel()` — the anti-leak guarantee.
 */

export interface VoiceButtonProps {
  /** Called when recording begins. Parent should snapshot its current draft. */
  onStart?: () => void;
  /** Called with the full voice segment so far (partial or final). */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Called on error with a user-friendly message. */
  onError?: (message: string) => void;
  /** Optional tooltip override. */
  title?: string;
  /** When disabled, button renders inert. */
  disabled?: boolean;
}

const BASE_CLASSES =
  "h-11 w-11 sm:h-9 sm:w-9 rounded-full inline-flex items-center justify-center " +
  "transition duration-fast ease-rcc " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const IDLE_CLASSES =
  "bg-transparent text-text-muted hover:bg-bg-surfaceStrong hover:text-text-secondary";

const SPEECH_RECORDING_CLASSES =
  "bg-danger text-white animate-pulse ring-2 ring-danger/60";

const RECORDER_RECORDING_CLASSES =
  "bg-danger/90 text-white animate-pulse";

export function VoiceButton(props: VoiceButtonProps): JSX.Element {
  const [recording, setRecording] = createSignal(false);
  const [mode, setMode] = createSignal<"speech" | "recorder" | null>(null);
  let handle: DictationHandle | null = null;

  const supported = () => isSpeechSupported() || hasMediaRecorder();

  function reset() {
    setRecording(false);
    setMode(null);
    handle = null;
  }

  async function toggle() {
    if (props.disabled) return;
    if (recording()) {
      handle?.stop();
      return;
    }
    if (!supported()) {
      props.onError?.(errorMessage("unsupported"));
      return;
    }
    props.onStart?.();
    setRecording(true);
    try {
      handle = await startDictation({
        onMode: (m) => setMode(m),
        onPartial: (text) => props.onTranscript(text, false),
        onFinal: (text) => {
          if (text) props.onTranscript(text, true);
          reset();
        },
        onError: (code, detail) => {
          props.onError?.(errorMessage(code));
          if (detail) console.warn("[voice]", code, detail);
          reset();
        },
      });
    } catch (err: any) {
      console.warn("[voice] start failed", err);
      props.onError?.("无法启动语音输入");
      reset();
    }
  }

  onCleanup(() => {
    if (handle) {
      try { handle.cancel(); } catch { /* ignore */ }
      handle = null;
    }
  });

  const cls = () => {
    if (!recording()) return `${BASE_CLASSES} ${IDLE_CLASSES}`;
    if (mode() === "recorder") return `${BASE_CLASSES} ${RECORDER_RECORDING_CLASSES}`;
    return `${BASE_CLASSES} ${SPEECH_RECORDING_CLASSES}`;
  };

  const tooltip = () => {
    if (props.title) return props.title;
    if (!supported()) return "此设备不支持语音输入";
    if (recording() && mode() === "recorder") return "录音中 · 停止后 Whisper 转写";
    if (recording()) return "停止语音输入";
    return "语音输入";
  };

  return (
    <button
      type="button"
      class={cls()}
      onClick={toggle}
      disabled={props.disabled || !supported()}
      aria-label="语音输入"
      aria-pressed={recording()}
      title={tooltip()}
    >
      <span class="text-[16px] leading-none" aria-hidden="true">🎤</span>
    </button>
  );
}

export default VoiceButton;
