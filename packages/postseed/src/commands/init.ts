import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CONFIG_TEMPLATE } from "../config";
import { style, type Io } from "../io";
import { parseFlags } from "../shared";

export const INIT_HELP = `postseed init: write a starter postseed.config.ts

  postseed init [--force]
`;

export async function runInit(argv: string[], io: Io): Promise<number> {
  const { values } = parseFlags(argv, { force: { type: "boolean" } });
  if (values.help) {
    io.out(INIT_HELP);
    return 0;
  }
  const s = style(io);
  const file = resolve(io.cwd, "postseed.config.ts");
  if (existsSync(file) && values.force !== true) {
    io.err(`${s.red("✖")} postseed.config.ts already exists. Use --force to overwrite it.\n`);
    return 1;
  }
  await writeFile(file, CONFIG_TEMPLATE);
  io.err(`${s.green("✔")} Wrote postseed.config.ts\n`);
  return 0;
}
