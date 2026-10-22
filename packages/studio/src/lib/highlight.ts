export type TokenClass = "keyword" | "ident" | "string" | "number" | "comment" | "func" | "plain";
export interface Token {
  text: string;
  cls: TokenClass;
}

const KEYWORDS = new Set([
  "begin", "commit", "insert", "into", "values", "update", "set", "where", "select", "overriding", "system", "value", "null", "true", "false",
  "constraints", "all", "deferred", "and", "or", "from", "as", "on", "truncate", "restart", "identity", "cascade", "table",
]);

/**
 * Splits text into lines of tokens. SQL strings may span lines, so the in-string state is carried over.
 * Deliberately small: it only needs to make the generated script easy to read.
 */
export function highlight(text: string, format: "sql" | "json" | "csv"): Token[][] {
  const lines = text.split("\n");
  if (format === "csv") {
    return lines.map((line, i) => {
      if (line.startsWith("# ")) return [{ text: line, cls: "comment" as const }];
      if (i === 0 || lines[i - 1]?.startsWith("# ")) return [{ text: line, cls: "keyword" as const }];
      return [{ text: line, cls: "plain" as const }];
    });
  }
  if (format === "json") return lines.map((line) => jsonLine(line));
  const out: Token[][] = [];
  let inString = false;
  let escape = false;
  for (const line of lines) {
    const tokens: Token[] = [];
    let i = 0;
    const push = (text: string, cls: TokenClass): void => {
      const last = tokens[tokens.length - 1];
      if (last && last.cls === cls) last.text += text;
      else tokens.push({ text, cls });
    };
    if (inString) {
      let j = 0;
      while (j < line.length) {
        const ch = line[j] as string;
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "'") {
          if (line[j + 1] === "'") j++;
          else {
            inString = false;
            j++;
            break;
          }
        }
        j++;
      }
      push(line.slice(0, j), "string");
      i = j;
    }
    while (i < line.length) {
      const ch = line[i] as string;
      if (ch === "-" && line[i + 1] === "-") {
        push(line.slice(i), "comment");
        break;
      }
      if (ch === "'" || ((ch === "E" || ch === "e") && line[i + 1] === "'")) {
        const isE = ch !== "'";
        let j = i + (isE ? 2 : 1);
        let esc = false;
        let closed = false;
        while (j < line.length) {
          const c = line[j] as string;
          if (esc) esc = false;
          else if (isE && c === "\\") esc = true;
          else if (c === "'") {
            if (line[j + 1] === "'") j++;
            else {
              closed = true;
              j++;
              break;
            }
          }
          j++;
        }
        push(line.slice(i, j), "string");
        if (!closed) {
          inString = true;
          escape = esc;
        }
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(line[i + 1] ?? ""))) {
        let j = i + 1;
        while (j < line.length && /[0-9.]/.test(line[j] as string)) j++;
        push(line.slice(i, j), "number");
        i = j;
        continue;
      }
      if (/[A-Za-z_"]/.test(ch)) {
        let j = i + 1;
        if (ch === '"') {
          while (j < line.length && line[j] !== '"') j++;
          j++;
        } else while (j < line.length && /[A-Za-z0-9_$]/.test(line[j] as string)) j++;
        const word = line.slice(i, j);
        const lower = word.toLowerCase();
        if (KEYWORDS.has(lower)) push(word, "keyword");
        else if (line[j] === "(" && !line.slice(0, i).trim().endsWith("INTO")) push(word, "func");
        else push(word, "ident");
        i = j;
        continue;
      }
      push(ch, "plain");
      i++;
    }
    out.push(tokens.length ? tokens : [{ text: "", cls: "plain" }]);
  }
  return out;
}

function jsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([^"\d\-tfn]+|.)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], cls: m[2] ? "ident" : "string" });
      if (m[2]) tokens.push({ text: m[2], cls: "plain" });
    } else if (m[3] !== undefined) tokens.push({ text: m[3], cls: "number" });
    else if (m[4] !== undefined) tokens.push({ text: m[4], cls: "keyword" });
    else tokens.push({ text: m[5] ?? "", cls: "plain" });
  }
  return tokens.length ? tokens : [{ text: "", cls: "plain" }];
}
