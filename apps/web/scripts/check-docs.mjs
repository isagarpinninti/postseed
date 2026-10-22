// Fails if any Markdown file in the repository links to a file that does not exist, or the npm README is stale.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const files = [
  ...["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md"].map((f) => resolve(root, f)),
  ...readdirSync(resolve(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => resolve(root, "docs", f)),
  ...["packages/core", "packages/pg", "wrappers/python", "wrappers/ruby"].map((d) => resolve(root, d, "README.md")),
];

let bad = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/(?:\]\(|src=")([^)"\s#]+)(?:#[^)"\s]*)?[)"]/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|\/)/.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) {
      console.error(`${file.replace(root + "/", "")}: broken link to ${target}`);
      bad++;
    }
  }
}
try {
  execFileSync("node", [resolve(root, "scripts/sync-readme.mjs"), "--check"], { stdio: "inherit" });
} catch {
  bad++;
}
if (bad) process.exit(1);
console.log(`docs links ok (${files.length} files)`);
