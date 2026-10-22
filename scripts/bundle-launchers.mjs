// Builds one self-contained copy of the CLI + Studio and drops it into the Python and Ruby packages.
// The npm package stays the source of truth: the launchers run exactly the same JavaScript with Node.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const studio = resolve(root, "packages/postseed/studio-dist");
if (!existsSync(resolve(studio, "index.html"))) throw new Error("Build first: pnpm build");

const require = createRequire(resolve(root, "packages/postseed/package.json"));
const jitiDir = dirname(require.resolve("jiti/package.json"));
const version = JSON.parse(readFileSync(resolve(root, "packages/postseed/package.json"), "utf8")).version;

const targets = [
  { engine: resolve(root, "wrappers/python/src/postseed/_engine"), studio: resolve(root, "wrappers/python/src/postseed/studio-dist") },
  { engine: resolve(root, "wrappers/ruby/lib/postseed/engine"), studio: resolve(root, "wrappers/ruby/lib/postseed/studio-dist") },
];

const tmp = resolve(root, "node_modules/.cache/launchers");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
await build({
  entryPoints: [resolve(root, "packages/postseed/src/cli.ts")],
  outfile: resolve(tmp, "postseed.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  legalComments: "none",
  // jiti loads TypeScript config files and cannot be bundled; it is copied next to the bundle instead.
  external: ["jiti", "pg-native"],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
});

for (const t of targets) {
  rmSync(t.engine, { recursive: true, force: true });
  rmSync(t.studio, { recursive: true, force: true });
  mkdirSync(resolve(t.engine, "node_modules"), { recursive: true });
  cpSync(resolve(tmp, "postseed.mjs"), resolve(t.engine, "postseed.mjs"));
  cpSync(jitiDir, resolve(t.engine, "node_modules/jiti"), { recursive: true });
  cpSync(studio, t.studio, { recursive: true });
  writeFileSync(resolve(t.engine, "package.json"), JSON.stringify({ name: "postseed-engine", version, private: true, type: "module" }));
  const size = readdirSync(t.engine).length;
  console.log(`bundled ${version} into ${t.engine.replace(root + "/", "")} (${size} entries) and ${t.studio.replace(root + "/", "")}`);
}
