import { style, type Io } from "../io";
import { openSource, parseFlags, resolveOptions, UsageError } from "../shared";

export const INTROSPECT_HELP = `postseed introspect: show what Postseed sees in a database

  postseed introspect --url $DATABASE_URL [--db-schema public] [--json]
`;

export async function runIntrospect(argv: string[], io: Io): Promise<number> {
  const { values } = parseFlags(argv, {});
  if (values.help) {
    io.out(INTROSPECT_HELP);
    return 0;
  }
  const r = await resolveOptions(io, values);
  if (!r.url && !r.schemaFile) throw new UsageError("introspect needs --url <postgres://…> (or --schema <file.sql>).");
  const s = style(io);
  const src = await openSource(io, r, { needExisting: false });
  try {
    if (values.json) {
      io.out(`${JSON.stringify(src.db, null, 2)}\n`);
      return 0;
    }
    io.out(`${src.db.tables.length} tables, ${src.db.enums.length} enums${src.info ? ` in ${s.bold(src.info.database)} (PostgreSQL ${src.info.serverVersion})` : ""}\n\n`);
    for (const t of src.db.tables) {
      io.out(`${s.bold(`${t.schema}.${t.name}`)}  ${s.dim(`${t.columns.length} columns`)}\n`);
      for (const fk of t.foreignKeys) io.out(`  ${fk.columns.join(", ")} → ${fk.refTable}(${fk.refColumns.join(", ")})${fk.deferrable ? " deferrable" : ""}\n`);
      for (const u of t.uniques) io.out(`  unique (${u.columns.join(", ")})${u.partial ? " partial" : ""}\n`);
    }
    if (src.db.enums.length > 0) {
      io.out("\nEnums\n");
      for (const e of src.db.enums) io.out(`  ${e.name}: ${e.values.join(", ")}\n`);
    }
    for (const w of src.db.warnings) io.err(`${s.yellow("!")} ${w}\n`);
    return 0;
  } finally {
    await src.close();
  }
}
