import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export interface GuardState {
  port: number;
  token: string;
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const deny = (status: 403 | 421, message: string): Response =>
  new Response(JSON.stringify({ error: { code: "FORBIDDEN", message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/**
 * Studio is a local tool, so it defends itself:
 *  - Host must be this machine's own address (stops DNS rebinding),
 *  - a browser Origin, when present, must be this same origin (stops cross-site requests),
 *  - every API call needs the per-launch token in a header, every page/asset needs it in the cookie.
 * There is no CORS, so no other origin can read a response.
 */
export function guard(state: GuardState): MiddlewareHandler {
  return async (c, next) => {
    const hosts = new Set([`127.0.0.1:${state.port}`, `localhost:${state.port}`, `[::1]:${state.port}`]);
    const host = c.req.header("host") ?? "";
    if (!hosts.has(host)) return deny(421, "Unexpected Host header.");
    const origin = c.req.header("origin");
    if (origin !== undefined && !new Set([...hosts].map((h) => `http://${h}`)).has(origin)) return deny(403, "Cross-origin request refused.");
    const path = new URL(c.req.url).pathname;
    const fromHeader = c.req.header("x-postseed-token");
    if (path.startsWith("/api/")) {
      if (!fromHeader || !same(fromHeader, state.token)) return deny(403, "Missing or wrong token.");
      return next();
    }
    // The first page load carries ?t=...; trade it for an HttpOnly cookie and drop it from the URL.
    const url = new URL(c.req.url);
    const fromQuery = url.searchParams.get("t");
    if (fromQuery && same(fromQuery, state.token)) {
      setCookie(c, "postseed_token", state.token, { httpOnly: true, sameSite: "Strict", path: "/" });
      url.searchParams.delete("t");
      return c.redirect(`${url.pathname}${url.search}`, 302);
    }
    const cookie = getCookie(c, "postseed_token");
    if (!cookie || !same(cookie, state.token)) return deny(403, "Open Studio with the link printed in your terminal.");
    return next();
  };
}

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};
