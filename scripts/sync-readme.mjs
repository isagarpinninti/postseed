// The npm page for `postseed` shows packages/postseed/README.md. Relative links and images in the root README
// would be broken there, so this writes a copy with absolute GitHub URLs. Run it after editing the root README;
// `pnpm test` fails if the copy is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/isagarpinninti/postseed";

export function render() {
  const src = readFileSync(resolve(root, "README.md"), "utf8");
  return src
    .replace(/(<img [^>]*src=")(?!https?:)([^"]+)"/g, (_, a, p) => `${a}${REPO}/raw/main/${p}"`)
    .replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, p) => `](${REPO}/blob/main/${p.replace(/^\.\//, "")})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = resolve(root, "packages/postseed/README.md");
  if (process.argv.includes("--check")) {
    if (readFileSync(out, "utf8") !== render()) {
      console.error("packages/postseed/README.md is stale: run `node scripts/sync-readme.mjs`");
      process.exit(1);
    }
    console.log("package README is in sync");
  } else {
    writeFileSync(out, render());
    console.log("wrote packages/postseed/README.md");
  }
}
