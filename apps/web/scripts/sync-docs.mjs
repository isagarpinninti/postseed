// Turns the Markdown in /docs into the website's pages. The /docs folder is the single source of truth, so
// GitHub readers and website readers see the same text. Links like [x](CONFIG.md) become /docs/config/.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../../docs");
const to = resolve(here, "../content/docs");
const ORDER = ["QUICKSTART", "CONFIG", "DETERMINISM", "SECURITY_MODEL", "FAQ"];

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });

const slug = (name) => name.toLowerCase().replace(/_/g, "-");
const pages = [];
for (const name of ORDER) {
  const file = `${name}.md`;
  if (!readdirSync(from).includes(file)) throw new Error(`docs/${file} is missing`);
  let text = readFileSync(resolve(from, file), "utf8");
  const title = /^# (.+)$/m.exec(text)?.[1] ?? name;
  const description = text.split("\n").find((l, i) => i > 0 && l.trim() && !l.startsWith("#") && !l.startsWith("```")) ?? "";
  text = text.replace(/\]\(([A-Z_]+)\.md(#[^)]*)?\)/g, (_, n, hash) => `](/docs/${slug(n)}/${hash ?? ""})`);
  // MDX treats { and < outside code as syntax; the docs are written to avoid both, and this guards the rest.
  const body = text.split(/(```[\s\S]*?```)/g).map((part, i) => (i % 2 ? part : part.replace(/<(?![a-zA-Z/!])/g, "&lt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;"))).join("");
  writeFileSync(resolve(to, `${slug(name)}.mdx`), body);
  pages.push({ slug: slug(name), title, description: description.replace(/[*_`]/g, "").slice(0, 180) });
}
writeFileSync(resolve(to, "index.json"), JSON.stringify(pages, null, 2));
console.log(`synced ${pages.length} docs pages`);
