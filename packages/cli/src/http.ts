export class HttpError extends Error {
  status: number;
  code: string;
  body: unknown;
  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return b + p;
}

export async function request<T>(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; token?: string; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  let url = joinUrl(base, path);
  if (init.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method: init.method ?? "GET", headers, body });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(0, "network_error", `network error: ${msg}`, null);
  }
  const ct = res.headers.get("content-type") ?? "";
  let parsed: unknown = null;
  const text = await res.text();
  if (text.length) {
    if (ct.includes("json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else {
      parsed = text;
    }
  }
  if (!res.ok) {
    const obj = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null) ?? null;
    const errMsg = obj && typeof obj.error === "string" ? obj.error : `HTTP ${res.status}`;
    const code = obj && typeof obj.code === "string" ? obj.code : `http_${res.status}`;
    throw new HttpError(res.status, code, errMsg, parsed);
  }
  return parsed as T;
}
