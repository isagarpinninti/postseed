import { saveBlob } from "./download";

const meta = typeof document === "undefined" ? null : document.querySelector('meta[name="postseed-token"]')?.getAttribute("content");
export const TOKEN: string = meta || (import.meta.env.VITE_POSTSEED_TOKEN as string | undefined) || "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly hint?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const headers = (json: boolean): Record<string, string> => ({ "x-postseed-token": TOKEN, ...(json ? { "content-type": "application/json" } : {}) });

async function fail(res: Response): Promise<never> {
  let code = "ERROR";
  let message = `Request failed (${res.status}).`;
  let hint: string | undefined;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; hint?: string; details?: Record<string, unknown> } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    hint = body.error?.hint;
    details = body.error?.details;
  } catch {
    /* not JSON */
  }
  throw new ApiError(message, code, res.status, hint, details);
}

export async function api<T>(path: string, body?: unknown, method?: "GET" | "POST" | "DELETE"): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: headers(body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

export interface SseMessage {
  event: string;
  data: unknown;
}

/** POSTs and reads a Server-Sent Events response, calling `onEvent` as each message arrives. */
export async function stream(path: string, body: unknown, onEvent: (m: SseMessage) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(path, { method: "POST", headers: headers(true), body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  if (!res.ok) return fail(res);
  if (!res.body) throw new ApiError("The server sent no data.", "EMPTY", res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (data !== undefined) onEvent({ event, data: JSON.parse(data) });
    }
  }
}

/** Downloads the response body as a file. */
export async function downloadFile(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, { method: "POST", headers: headers(true), body: JSON.stringify(body) });
  if (!res.ok) return fail(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "seed.sql";
  saveBlob(await res.blob(), name);
}

export { saveBlob };
