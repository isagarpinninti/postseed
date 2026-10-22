import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { SECURITY_HEADERS } from "./security";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const MISSING = `<!doctype html><meta charset="utf-8"><title>Postseed</title>
<body style="font:16px system-ui;margin:3rem;max-width:40rem"><h1>Postseed Studio assets are missing</h1>
<p>This install has no <code>studio-dist</code> folder. Reinstall the <code>postseed</code> package, or build it from source with <code>pnpm build</code>.</p></body>`;

/** Serves the built Studio. Paths are confined to the assets folder; unknown paths fall back to the SPA shell. */
export async function serveStatic(root: string | undefined, pathname: string, token?: string): Promise<Response> {
  const headers = (type: string, extra: Record<string, string> = {}): Record<string, string> => ({ "content-type": type, ...SECURITY_HEADERS, ...extra });
  if (!root) return new Response(MISSING, { status: 503, headers: headers(TYPES[".html"] as string, { "cache-control": "no-store" }) });
  let rel = decodeURIComponent(pathname);
  if (rel.includes("\0")) return new Response("Not found", { status: 404 });
  rel = normalize(rel).replace(/^([/\\])+/, "");
  const file = join(root, rel);
  if (file !== root && !file.startsWith(root + sep)) return new Response("Not found", { status: 404 });
  const tryRead = async (p: string): Promise<Buffer | undefined> => {
    try {
      if (!(await stat(p)).isFile()) return undefined;
      return await readFile(p);
    } catch {
      return undefined;
    }
  };
  const direct = rel === "" ? undefined : await tryRead(file);
  if (direct) {
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const immutable = rel.startsWith("assets/");
    return new Response(new Uint8Array(direct), { headers: headers(type, { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store" }) });
  }
  if (extname(rel) !== "") return new Response("Not found", { status: 404 });
  const index = await tryRead(join(root, "index.html"));
  if (!index) return new Response(MISSING, { status: 503, headers: headers(TYPES[".html"] as string, { "cache-control": "no-store" }) });
  // The shell is only served to requests that already hold the cookie, so it may carry the API token
  // (an HttpOnly cookie cannot be read by the page itself).
  const meta = `<meta name="postseed-token" content="${token ?? ""}">`;
  const source = index.toString("utf8");
  const html = /<head[^>]*>/i.test(source)
    ? source.replace(/<head[^>]*>/i, (m) => `${m}${meta}`)
    : source.replace(/^(<!doctype[^>]*>)?/i, (m) => `${m}${meta}`);
  return new Response(html, { headers: headers(TYPES[".html"] as string, { "cache-control": "no-store" }) });
}
