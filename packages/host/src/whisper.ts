import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";

interface WhisperConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function parseMultipart(
  buf: Buffer,
  boundary: string,
): { field: string; filename: string; contentType: string; data: Buffer } | null {
  const delim = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from("\r\n");
  let idx = buf.indexOf(delim);
  if (idx < 0) return null;
  idx += delim.length;
  while (idx < buf.length) {
    if (buf[idx] === 0x2d && buf[idx + 1] === 0x2d) return null;
    if (buf[idx] === 0x0d && buf[idx + 1] === 0x0a) idx += 2;
    const headerEnd = buf.indexOf(Buffer.from("\r\n\r\n"), idx);
    if (headerEnd < 0) return null;
    const headerRaw = buf.subarray(idx, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;
    const nextDelim = buf.indexOf(delim, bodyStart);
    if (nextDelim < 0) return null;
    const bodyEnd = buf[nextDelim - 2] === 0x0d && buf[nextDelim - 1] === 0x0a ? nextDelim - 2 : nextDelim;
    const data = buf.subarray(bodyStart, bodyEnd);

    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerRaw);
    const ctype = /content-type:\s*([^\r\n]+)/i.exec(headerRaw);
    const nameMatch = disp ? /name="([^"]+)"/i.exec(disp[1] ?? "") : null;
    const filenameMatch = disp ? /filename="([^"]*)"/i.exec(disp[1] ?? "") : null;
    const field = nameMatch?.[1] ?? "";
    if (field === "audio") {
      return {
        field,
        filename: filenameMatch?.[1] || "audio.webm",
        contentType: ctype?.[1]?.trim() || "application/octet-stream",
        data,
      };
    }
    idx = nextDelim + delim.length;
    crlf; // silence unused
  }
  return null;
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > max) {
        aborted = true;
        const err = new Error("payload too large") as Error & { code?: string };
        err.code = "E_TOO_LARGE";
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (!aborted) reject(err);
    });
  });
}

export async function handleWhisperRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cfg = await loadConfig();
  const w = (cfg.whisper ?? {}) as WhisperConfig;
  const apiKey = typeof w.apiKey === "string" ? w.apiKey.trim() : "";
  if (!apiKey) {
    sendJson(res, 501, {
      error: "whisper not configured; set whisper.apiKey in ~/.rcc/config.json",
    });
    return;
  }
  const model = (typeof w.model === "string" && w.model.trim()) || DEFAULT_MODEL;
  const endpoint = (typeof w.endpoint === "string" && w.endpoint.trim()) || DEFAULT_ENDPOINT;

  const ctype = (req.headers["content-type"] as string | undefined) ?? "";
  const m = /multipart\/form-data;\s*boundary=(.+)$/i.exec(ctype);
  if (!m) {
    sendJson(res, 400, { error: "content-type must be multipart/form-data" });
    return;
  }
  const boundary = m[1]!.trim().replace(/^"|"$/g, "");

  let body: Buffer;
  try {
    body = await readBody(req, MAX_BYTES);
  } catch (err: any) {
    if (err?.code === "E_TOO_LARGE") {
      sendJson(res, 413, { error: "audio too large (max 10MB)" });
      return;
    }
    sendJson(res, 400, { error: err?.message ?? "read error" });
    return;
  }

  const part = parseMultipart(body, boundary);
  if (!part) {
    sendJson(res, 400, { error: 'missing "audio" file part' });
    return;
  }

  try {
    const form = new FormData();
    const ab = part.data.buffer.slice(
      part.data.byteOffset,
      part.data.byteOffset + part.data.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: part.contentType });
    form.append("file", blob, part.filename);
    form.append("model", model);

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        error: "whisper upstream error",
        status: upstream.status,
        detail: text.slice(0, 500),
      });
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      sendJson(res, 502, { error: "upstream returned non-JSON" });
      return;
    }
    sendJson(res, 200, { text: String(parsed?.text ?? "") });
  } catch (err: any) {
    sendJson(res, 502, { error: err?.message ?? "upstream failed" });
  }
}
