import { generate, prepare, type GenerateOptions } from "@postseed/core";
import { addHistory, insertEvents, InsertError, isLocalHost, looksLikeProduction, redactUrl, truncateImpact } from "@postseed/pg";
import { style, type Io } from "../io";
import { openSource, parseFlags, resolveOptions, UsageError, withExisting } from "../shared";

export const INSERT_HELP = `postseed insert: generate and insert seed data in ONE transaction

  postseed insert --url $DATABASE_URL --rows 100 --seed 42 [--tables users,orders]
  postseed insert --url $DATABASE_URL --dry-run

Everything runs in a single transaction: if any row fails, nothing is committed.

  --dry-run              do everything, then ROLLBACK (validates CHECK, unique and foreign keys)
  --truncate             empty the selected tables first (TRUNCATE ... RESTART IDENTITY CASCADE).
                         Destructive. Needs --confirm-database <name> or typing the name at the prompt.
  --confirm-database <n> the database name; required for --truncate and for production-looking databases
  --yes                  skip the y/N prompt (still not enough for --truncate)

Takes the same options as generate: --rows, --table-rows, --tables, --seed, --null-ratio, --db-schema, --config.
Exit codes: 0 ok · 1 error · 2 usage · 3 dry run found a violation
`;

export async function runInsert(argv: string[], io: Io): Promise<number> {
  const { values } = parseFlags(argv, {
    "dry-run": { type: "boolean" },
    truncate: { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    "confirm-database": { type: "string" },
  });
  if (values.help) {
    io.out(INSERT_HELP);
    return 0;
  }
  const r = await resolveOptions(io, values);
  if (!r.url) throw new UsageError("insert needs a database: --url <postgres://…> (or set DATABASE_URL).");
  if (r.schemaFile) throw new UsageError("insert reads the schema from the database; remove --schema (use generate for a DDL file).");
  const s = style(io);
  const dryRun = values["dry-run"] === true;
  const src = await openSource(io, r, { needExisting: true });
  try {
    const client = src.client;
    const info = src.info;
    if (!client || !info) throw new UsageError("Could not open the database.");
    if (src.db.tables.length === 0) throw new UsageError(`No tables were found in schema "${r.dbSchema}". Use --db-schema to read another one.`);
    const prep = prepare(src.db, r.options);
    if (prep.errors.length > 0) {
      for (const e of prep.errors) io.err(`${s.red("✖")} ${e.message}\n`);
      return 1;
    }
    const existing = await withExisting(src, prep.selected);
    const options: GenerateOptions = { ...r.options, ...(existing ? { existing } : {}), name: info.database };
    const total = prep.selected.reduce((n, k) => n + (prep.rows[k] ?? 0), 0);
    const local = isLocalHost(r.url);
    const prod = looksLikeProduction(r.url, info.database);

    io.err(`${s.bold(dryRun ? "Dry run" : "Insert")}: ${total.toLocaleString("en-US")} rows into ${s.bold(info.database)} ${s.dim(`(${redactUrl(r.url)})`)}\n`);
    io.err(`  tables: ${prep.plan.order.map((k) => `${k.replace(/^public\./, "")}(${prep.rows[k]})`).join(", ")}\n`);
    for (const w of prep.warnings) io.err(`  ${s.yellow("!")} ${w}\n`);
    if (!local) io.err(`  ${s.yellow("!")} ${s.bold("This is not a local database")} (host ${new URL(r.url).hostname}).\n`);
    if (prod) io.err(`  ${s.yellow("!")} ${s.bold("The name looks like production.")}\n`);
    const impact = values.truncate ? truncateImpact(src.db, prep.selected) : [];
    if (values.truncate) {
      io.err(`  ${s.red("!")} --truncate will EMPTY the selected tables (TRUNCATE ... RESTART IDENTITY CASCADE)${impact.length ? ` and, through CASCADE, also: ${impact.join(", ")}` : ""}.\n`);
    }

    if (!dryRun) {
      const confirmed = values["confirm-database"] === info.database;
      const needsName = values.truncate === true || prod;
      if (needsName && !confirmed) {
        if (!io.interactive) {
          throw new UsageError(`Refusing to ${values.truncate ? "truncate" : "write to a production-looking database"} without confirmation: pass --confirm-database ${info.database}.`);
        }
        const typed = await io.prompt(`Type the database name (${info.database}) to continue: `);
        if (typed !== info.database) {
          io.err("Cancelled.\n");
          return 1;
        }
      } else if (!needsName && values.yes !== true && !confirmed) {
        if (!io.interactive) throw new UsageError("Pass --yes to insert without a prompt (or --dry-run to validate first).");
        const answer = await io.prompt(`Insert ${total.toLocaleString("en-US")} rows? [y/N] `);
        if (!/^y(es)?$/i.test(answer)) {
          io.err("Cancelled.\n");
          return 1;
        }
      }
    }

    let last = "";
    try {
      const result = await insertEvents(client, generate(src.db, options), {
        dryRun,
        truncate: values.truncate === true,
        onProgress: (p) => {
          if (p.rows === p.total && p.table !== last) {
            last = p.table;
            io.err(`  ${s.green("✔")} ${p.table.replace(/^public\./, "")} ${s.dim(`${p.rows.toLocaleString("en-US")} rows`)}\n`);
          }
        },
      });
      io.err(
        dryRun
          ? `${s.green("✔")} Dry run passed: ${result.totalRows.toLocaleString("en-US")} rows are valid. Nothing was changed. ${s.dim(`(${result.ms} ms)`)}\n`
          : `${s.green("✔")} Inserted ${result.totalRows.toLocaleString("en-US")} rows in ${(result.ms / 1000).toFixed(1)}s. Transaction committed.\n`,
      );
      await addHistory({
        connectionName: info.database,
        connectionUrl: r.url,
        tables: prep.selected,
        rows: result.totalRows,
        seed: options.seed ?? 42,
        format: "sql",
        action: dryRun ? "dry-run" : "insert",
        settings: { rowsPerTable: options.rows ?? 50, nullRatio: options.nullRatio ?? 0.1, ...(options.tableRows ? { tableRows: options.tableRows } : {}) },
      }).catch(() => undefined);
      return 0;
    } catch (e) {
      if (e instanceof InsertError) {
        io.err(`${s.red("✖")} ${e.message}\n`);
        io.err(`  ${dryRun ? "Dry run failed" : "Rolled back"}: ${dryRun ? "the real insert would fail the same way." : "no rows were committed."}\n`);
        return dryRun ? 3 : 1;
      }
      throw e;
    }
  } finally {
    await src.close();
  }
}
