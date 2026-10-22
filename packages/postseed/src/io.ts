import { createInterface } from "node:readline/promises";

/** Everything the commands touch outside their own logic, so tests can drive them without a terminal. */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** True when a person can answer prompts. */
  interactive: boolean;
  color: boolean;
  prompt: (question: string) => Promise<string>;
  readStdin: () => Promise<string>;
}

export function nodeIo(): Io {
  return {
    out: (t) => void process.stdout.write(t),
    err: (t) => void process.stderr.write(t),
    env: process.env,
    cwd: process.cwd(),
    interactive: !!process.stdin.isTTY && !!process.stderr.isTTY,
    color: !!process.stderr.isTTY && !process.env.NO_COLOR,
    async prompt(question) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

const wrap = (code: string, io: Io) => (s: string): string => (io.color ? `\u001b[${code}m${s}\u001b[0m` : s);
export const style = (io: Io) => ({
  bold: wrap("1", io),
  dim: wrap("2", io),
  red: wrap("31", io),
  green: wrap("32", io),
  yellow: wrap("33", io),
  cyan: wrap("36", io),
});
