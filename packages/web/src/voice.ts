// Dictation abstraction: Web Speech API primary (real-time partials),
// MediaRecorder → host /whisper fallback (one-shot transcript on stop).
//
// Both paths return a stop() function. onFinal always fires with the best
// transcript we have before stop resolves. onError fires with a short code
// that the UI can translate to a friendly message.

import { loadToken } from "./auth.ts";

type ErrCode =
  | "unsupported"
  | "permission_denied"
  | "no_mic"
  | "whisper_not_configured"
  | "whisper_upload_failed"
  | "whisper_too_large"
  | "recognition_failed"
  | "unknown";

export interface DictationOpts {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (code: ErrCode, detail?: string) => void;
  /** Called once we know whether we're on speech vs. recorder path. */
  onMode?: (mode: "speech" | "recorder") => void;
}

export interface DictationHandle {
  stop(): void;
  cancel(): void;
}

type AnySpeechCtor = new () => any;

function getSpeechCtor(): AnySpeechCtor | null {
  const w = window as any;
  return (w.SpeechRecognition as AnySpeechCtor | undefined)
    ?? (w.webkitSpeechRecognition as AnySpeechCtor | undefined)
    ?? null;
}

export function defaultLang(): string {
  const nav = navigator.language || "en-US";
  if (/^zh\b/i.test(nav)) return "zh-CN";
  if (/^en\b/i.test(nav)) return "en-US";
  return nav;
}

export function isSpeechSupported(): boolean {
  return getSpeechCtor() !== null;
}

export function hasMediaRecorder(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof (window as any).MediaRecorder !== "undefined";
}

export async function startDictation(opts: DictationOpts): Promise<DictationHandle> {
  const lang = opts.lang || defaultLang();
  const Ctor = getSpeechCtor();
  if (Ctor) {
    try {
      return startSpeech(Ctor, lang, opts);
    } catch (err: any) {
      opts.onError?.("recognition_failed", err?.message);
      // Fall through to recorder if possible.
    }
  }
  if (!hasMediaRecorder()) {
    opts.onError?.("unsupported", "no Web Speech API and no MediaRecorder");
    return { stop() {}, cancel() {} };
  }
  return startRecorder(opts);
}

function startSpeech(
  Ctor: AnySpeechCtor,
  lang: string,
  opts: DictationOpts,
): DictationHandle {
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = lang;

  let finalText = "";
  let lastInterim = "";
  let stopped = false;
  let cancelled = false;

  opts.onMode?.("speech");

  rec.onresult = (ev: any) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const t = r[0]?.transcript ?? "";
      if (r.isFinal) finalText += t;
      else interim += t;
    }
    lastInterim = interim;
    opts.onPartial?.((finalText + interim).trim());
  };

  rec.onerror = (ev: any) => {
    const err = String(ev?.error || "");
    if (err === "not-allowed" || err === "service-not-allowed") {
      opts.onError?.("permission_denied", err);
    } else if (err === "no-speech" || err === "aborted") {
      // benign; swallow
    } else {
      opts.onError?.("recognition_failed", err);
    }
  };

  rec.onend = () => {
    if (cancelled) return;
    const out = (finalText + lastInterim).trim();
    opts.onFinal(out);
  };

  try {
    rec.start();
  } catch (err: any) {
    opts.onError?.("recognition_failed", err?.message);
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { rec.stop(); } catch { /* ignore */ }
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      cancelled = true;
      try { rec.abort(); } catch { /* ignore */ }
    },
  };
}

async function startRecorder(opts: DictationOpts): Promise<DictationHandle> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err: any) {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      opts.onError?.("permission_denied", err?.message);
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      opts.onError?.("no_mic", err?.message);
    } else {
      opts.onError?.("unknown", err?.message);
    }
    return { stop() {}, cancel() {} };
  }

  opts.onMode?.("recorder");

  const mime = pickMime();
  let recorder: MediaRecorder;
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (err: any) {
    stream.getTracks().forEach((t) => t.stop());
    opts.onError?.("unknown", err?.message);
    return { stop() {}, cancel() {} };
  }

  const chunks: Blob[] = [];
  let cancelled = false;
  let finished = false;

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const done = new Promise<void>((resolve) => {
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled || finished) {
        resolve();
        return;
      }
      finished = true;
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      if (blob.size === 0) {
        opts.onFinal("");
        resolve();
        return;
      }
      try {
        const text = await uploadToWhisper(blob);
        opts.onFinal(text);
      } catch (err: any) {
        const code: ErrCode = err?.code || "whisper_upload_failed";
        opts.onError?.(code, err?.message);
        opts.onFinal("");
      }
      resolve();
    };
  });

  try {
    recorder.start();
  } catch (err: any) {
    stream.getTracks().forEach((t) => t.stop());
    opts.onError?.("unknown", err?.message);
    return { stop() {}, cancel() {} };
  }

  return {
    stop() {
      if (finished) return;
      try { recorder.stop(); } catch { /* ignore */ }
      void done;
    },
    cancel() {
      if (finished) return;
      cancelled = true;
      finished = true;
      try { recorder.stop(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

function pickMime(): string | null {
  const MR = (window as any).MediaRecorder;
  if (!MR || !MR.isTypeSupported) return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MR.isTypeSupported(c)) return c;
    } catch { /* ignore */ }
  }
  return null;
}

async function uploadToWhisper(blob: Blob): Promise<string> {
  const form = new FormData();
  const ext = /webm/i.test(blob.type) ? "webm" : /ogg/i.test(blob.type) ? "ogg" : "m4a";
  form.append("audio", blob, `audio.${ext}`);

  const headers: Record<string, string> = {};
  const token = loadToken();
  if (token) headers["authorization"] = `Bearer ${token}`;

  const resp = await fetch("/whisper", { method: "POST", body: form, headers });
  if (!resp.ok) {
    let detail = "";
    try {
      const j = await resp.json();
      detail = j?.error || "";
    } catch { /* ignore */ }
    const err = new Error(detail || `HTTP ${resp.status}`) as Error & { code?: ErrCode };
    if (resp.status === 501) err.code = "whisper_not_configured";
    else if (resp.status === 413) err.code = "whisper_too_large";
    else err.code = "whisper_upload_failed";
    throw err;
  }
  const data = (await resp.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export function errorMessage(code: ErrCode): string {
  switch (code) {
    case "permission_denied":
      return "麦克风权限被拒,请在浏览器设置中允许";
    case "no_mic":
      return "没有检测到麦克风设备";
    case "whisper_not_configured":
      return "Whisper 未配置,在 ~/.rcc/config.json 填 whisper.apiKey";
    case "whisper_too_large":
      return "录音过长(>10MB),请分段";
    case "whisper_upload_failed":
      return "上传 Whisper 失败";
    case "unsupported":
      return "此设备不支持语音输入";
    case "recognition_failed":
      return "语音识别出错";
    default:
      return "语音输入出错";
  }
}
