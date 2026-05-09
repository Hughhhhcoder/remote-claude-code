import { chmod, mkdir, stat, unlink } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RECORDINGS_DIR = join(homedir(), ".rcc", "recordings");
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

export interface RecorderHeader {
  version: 2;
  width: number;
  height: number;
  timestamp: number;
  title?: string;
  env?: Record<string, string>;
}

export interface RecordingStatus {
  sid: string;
  recording: boolean;
  size: number;
  startedAt: number | null;
  hasFile: boolean;
  capped: boolean;
}

/**
 * asciinema cast v2 writer for a single session. One Recorder owns one fd
 * opened in append mode: the header line is written once at start(), and
 * every subsequent write() appends a single JSONL event
 * `[t_offset_seconds, "o", data]`.
 *
 * On reaching the 50MB cap the recorder auto-stops and the file is sealed in
 * place (no truncation) so partial recordings remain playable.
 */
export class Recorder {
  readonly sid: string;
  readonly path: string;
  private stream: WriteStream | null = null;
  private startedAt = 0;
  private size = 0;
  private capped = false;
  private stopped = false;
  /** Invoked exactly once on auto-stop so the session can flip its state. */
  private readonly onAutoStop: (() => void) | undefined;

  constructor(sid: string, onAutoStop?: () => void) {
    this.sid = sid;
    this.path = recordingPathFor(sid);
    this.onAutoStop = onAutoStop;
  }

  async start(opts: { cols: number; rows: number; title?: string }): Promise<void> {
    await mkdir(RECORDINGS_DIR, { recursive: true, mode: 0o700 });
    // Truncate on (re)start — a fresh recording replaces any previous cast.
    this.stream = createWriteStream(this.path, { flags: "w", mode: 0o600 });
    this.startedAt = Date.now();
    const header: RecorderHeader = {
      version: 2,
      width: opts.cols,
      height: opts.rows,
      timestamp: Math.floor(this.startedAt / 1000),
      ...(opts.title ? { title: opts.title } : {}),
      env: { TERM: "xterm-256color" },
    };
    const line = JSON.stringify(header) + "\n";
    await this.writeRaw(line);
    try {
      await chmod(this.path, 0o600);
    } catch {
      // best-effort; stream already created with mode 0o600
    }
  }

  write(data: string): void {
    if (!this.stream || this.stopped || this.capped) return;
    const t = (Date.now() - this.startedAt) / 1000;
    const line = JSON.stringify([t, "o", data]) + "\n";
    const buf = Buffer.from(line, "utf8");
    if (this.size + buf.length > MAX_RECORDING_BYTES) {
      // Refuse the write that would breach the cap, seal the file, and fire
      // the auto-stop callback so the session flips its recording flag.
      this.capped = true;
      void this.stop("cap");
      return;
    }
    this.size += buf.length;
    try {
      this.stream.write(buf);
    } catch {
      // fd closed out from under us; treat as stopped.
      this.stopped = true;
    }
  }

  async stop(reason: "user" | "exit" | "cap" = "user"): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      await new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
    }
    if (reason === "cap") this.onAutoStop?.();
  }

  private writeRaw(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) {
        reject(new Error("stream not open"));
        return;
      }
      const buf = Buffer.from(line, "utf8");
      this.size += buf.length;
      this.stream.write(buf, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getStartedAt(): number {
    return this.startedAt;
  }

  getSize(): number {
    return this.size;
  }

  isCapped(): boolean {
    return this.capped;
  }

  isRecording(): boolean {
    return !!this.stream && !this.stopped;
  }
}

export function recordingPathFor(sid: string): string {
  // sid is 8-char uuid (plus resume-reuse), but guard against path traversal.
  const safe = sid.replace(/[^a-zA-Z0-9_-]/g, "");
  return join(RECORDINGS_DIR, `${safe}.cast`);
}

export async function recordingFileSize(sid: string): Promise<number> {
  try {
    const st = await stat(recordingPathFor(sid));
    return st.size;
  } catch {
    return 0;
  }
}

export async function recordingFileExists(sid: string): Promise<boolean> {
  try {
    await stat(recordingPathFor(sid));
    return true;
  } catch {
    return false;
  }
}

export async function deleteRecording(sid: string): Promise<boolean> {
  try {
    await unlink(recordingPathFor(sid));
    return true;
  } catch {
    return false;
  }
}
