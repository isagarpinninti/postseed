import { Faker, base, en } from "@faker-js/faker";
import type { Column, Table } from "./ir";
import type { Rng } from "./prng";
import type { Value } from "./value";

/**
 * Reference "now" for relative dates. It is a constant, not the clock: the same schema, seed and
 * version must give byte-identical output on any day. Override it with the `now` option.
 */
export const DEFAULT_NOW = Date.UTC(2026, 0, 1);

export const DAY = 86_400_000;

/** What a column generator needs: its own random stream and a lazily-built, equally seeded Faker. */
export class Env {
  private f: Faker | undefined;

  constructor(
    readonly rng: Rng,
    readonly seed: number,
    readonly table: Table,
    readonly col: Column,
    readonly now: number,
  ) {}

  get faker(): Faker {
    if (!this.f) {
      this.f = new Faker({ locale: [en, base] });
      this.f.seed(this.seed);
      this.f.setDefaultRefDate(new Date(this.now));
    }
    return this.f;
  }
}

export type Gen = (i: number) => Value;
export type GenFactory = (env: Env) => Gen;

/** Resolves `internet.email` against a Faker instance into a bound function. */
export function fakerFn(faker: Faker, path: string): (...args: unknown[]) => unknown {
  let target: unknown = faker;
  let owner: unknown = faker;
  for (const part of path.split(".")) {
    owner = target;
    target = (target as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof target !== "function") {
    throw new Error(`Unknown Faker method "${path}". Use a path such as "internet.email" or "person.fullName".`);
  }
  return (...args) => (target as (...a: unknown[]) => unknown).apply(owner, args);
}
