// Copies the built Studio (packages/studio/dist) next to the CLI so `npx postseed` can serve it.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../../studio/dist");
const to = resolve(here, "../studio-dist");
if (!existsSync(resolve(from, "index.html"))) {
  console.error("Studio is not built: run `pnpm --filter @postseed/studio build` first.");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copied Studio to ${to}`);
