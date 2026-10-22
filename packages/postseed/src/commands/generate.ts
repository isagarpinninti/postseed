import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generate, prepare, writeCsv, writeJson, writeSql, PostseedError, type GenerateOptions, type Database } from "@postseed/core";
import { style, type Io } from "../io";
import { openSource, parseFlags, resolveOptions, UsageError, withExisting } from "../shared";

export const GENERATE_HELP = `postseed generate: write seed data for a schema

  postseed generate --schema ./schema.sql [--rows 50] [--seed 42] [--format sql|json|csv] [--out ./seed.sql]
  postseed generate --url $DATABASE_URL --tables users,orders --rows 200

Source (one of):
  --schema <file>        DDL (CREATE TABLE ...); use - for stdin
  --url <postgres://…>   introspect a live database (default: $DATABASE_URL)
  --db-schema <names>    database schema(s) to read (default public)

Options:
  --rows <n>             rows per table (default 50)
  --table-rows a=10,b=500   per-table counts
  --tables a,b           only these tables
  --seed <n>             same schema + seed + version gives identical output (default 42)
  --null-ratio <0..1>    chance that a nullable column is NULL (default 0.1)
  --fk-distribution uniform|zipf
  --format sql|json|csv  (default sql); json: add --ndjson for one row per line
  --out <path>           file (sql/json) or directory (csv); default stdout
  --now <date>           reference date for relative timestamps (default: a fixed constant)
  --config <file>        postseed.config.ts (found automatically in the current directory)
`;

async function writeChunks(chunks: Iterable<string>, out: string | undefined, io: Io): Promise<void> {
  if (!out) {
    for (const c of chunks) io.out(c);
    return;
  }
  const file = resolve(io.cwd, out);
  await mkdir(dirname(file), { recursive: true });
  const stream = createWriteStream(file);
  await new Promise<void>((done, fail) => {
    stream.on("error", fail);
    stream.on("finish", done);
    const it = chunks[Symbol.iterator]();
    const pump = (): void => {
      for (;;) {
        const n = it.next();
        if (n.done) return void stream.end();
        if (!stream.write(n.value)) return void stream.once("drain", pump);
      }
    };
    pump();
  });
}

/** Builds the events once; shared by generate and insert. */
export function buildEvents(db: Database, options: GenerateOptions): ReturnType<typeof generate> {
  return generate(db, options);
}

export async function runGenerate(argv: string[], io: Io): Promise<number> {
  const { values } = parseFlags(argv, { format: { type: "string" }, out: { type: "string" }, ndjson: { type: "boolean" }, name: { type: "string" } });
  if (values.help) {
    io.out(GENERATE_HELP);
    return 0;
  }
  const format = (values.format as string | undefined) ?? "sql";
  if (format !== "sql" && format !== "json" && format !== "csv") throw new UsageError('--format must be "sql", "json" or "csv".');
  const out = values.out as string | undefined;
  if (format === "csv" && !out) throw new UsageError("--format csv writes one file per table, so --out <directory> is required.");
  const r = await resolveOptions(io, values);
  const s = style(io);
  const src = await openSource(io, r, { needExisting: true });
  try {
    if (src.db.tables.length === 0) {
      const hint = src.db.warnings[0] ? ` ${src.db.warnings[0]}` : "";
      throw new PostseedError(src.client ? `No tables were found in schema "${r.dbSchema}".` : `No CREATE TABLE statements were found in the schema.${hint}`, "UNKNOWN_TABLE");
    }
    const prep = prepare(src.db, r.options);
    if (prep.errors.length > 0 && !src.client) throw new PostseedError(prep.errors.map((e) => e.message).join("\n"), prep.errors[0]?.code ?? "UNSUPPORTED");
    const existing = await withExisting(src, prep.selected);
    const options: GenerateOptions = { ...r.options, ...(existing ? { existing } : {}), name: (values.name as string | undefined) ?? (r.schemaFile === "-" ? "stdin" : r.schemaFile ? r.schemaFile : src.info?.database ?? "database") };
    const started = Date.now();
    let rows = 0;
    const counting = function* (): Generator<ReturnType<typeof generate> extends Generator<infer E> ? E : never> {
      for (const e of generate(src.db, options)) {
        if (e.type === "rows") rows += e.rows.length;
        yield e;
      }
    };
    if (format === "sql") await writeChunks(writeSql(counting()), out, io);
    else if (format === "json") await writeChunks(writeJson(counting(), { mode: values.ndjson ? "ndjson" : "object" }), out, io);
    else {
      const dir = resolve(io.cwd, out as string);
      await mkdir(dir, { recursive: true });
      const files = new Map<string, string[]>();
      for (const c of writeCsv(counting())) files.set(c.file, [...(files.get(c.file) ?? []), c.text]);
      for (const [file, parts] of files) await writeFile(resolve(dir, file), parts.join(""));
    }
    const seed = options.seed ?? 42;
    io.err(`${s.green("✔")} ${rows.toLocaleString("en-US")} rows across ${prep.selected.length} table${prep.selected.length === 1 ? "" : "s"} ${s.dim(`· seed ${seed} · ${Date.now() - started} ms`)}\n`);
    for (const w of prep.warnings) io.err(`${s.yellow("!")} ${w}\n`);
    return 0;
  } finally {
    await src.close();
  }
}
