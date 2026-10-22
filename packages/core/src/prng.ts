/** Seeded, dependency-free PRNG (xmur3 string hash feeding sfc32). Same inputs always give the same stream. */

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
    for (let i = 0; i < 15; i++) this.uint32();
  }

  /** A stream derived from the root seed and a path, e.g. `Rng.fromKey(42, "public.users", "email")`. */
  static fromKey(...parts: Array<string | number>): Rng {
    const h = xmur3(parts.join("\u0000"));
    return new Rng(h(), h(), h(), h());
  }

  uint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.uint32() / 4294967296;
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    const span = max - min + 1;
    if (span <= 4294967296) return min + Math.floor(this.float() * span);
    // Wide ranges: combine two draws; precision is limited to 2^53, which is all JS numbers hold anyway.
    return min + Math.floor((this.float() + this.float() / 4294967296) * span);
  }

  bool(probability = 0.5): boolean {
    return this.float() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot pick from an empty list");
    return items[Math.floor(this.float() * items.length)] as T;
  }

  /** Index chosen with the given non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** RFC 4122 version 4 UUID built from this stream, so it is reproducible. */
  uuid(): string {
    const hex = (n: number): string => n.toString(16).padStart(8, "0");
    const a = hex(this.uint32());
    const b = hex(this.uint32());
    const c = hex(this.uint32());
    const d = hex(this.uint32());
    const variant = ((parseInt(c.slice(0, 1), 16) & 0x3) | 0x8).toString(16);
    return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${variant}${c.slice(1, 4)}-${c.slice(4)}${d}`;
  }
}
