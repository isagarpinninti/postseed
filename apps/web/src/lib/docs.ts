import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DocPage {
  slug: string;
  title: string;
  description: string;
}

const dir = resolve(process.cwd(), "content/docs");

export function listDocs(): DocPage[] {
  return JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8")) as DocPage[];
}

export function readDoc(slug: string): string {
  return readFileSync(resolve(dir, `${slug}.mdx`), "utf8");
}
