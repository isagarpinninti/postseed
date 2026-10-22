/** `schema.table`, the same key the engine uses. Kept here so the main bundle does not import the engine. */
export const tableKey = (t: { schema: string; name: string }): string => `${t.schema}.${t.name}`;
