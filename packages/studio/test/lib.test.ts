import { describe, expect, it } from "vitest";
import { highlight } from "../src/lib/highlight";
import { MAX_ROWS, MIN_ROWS, bytes, fmt, rowsToSlider, sliderToRows } from "../src/lib/scale";
import { requestKey } from "../src/lib/store";
import { DEFAULT_SETTINGS } from "../src/lib/store";

describe("rows slider (logarithmic)", () => {
  it("maps the ends of the slider to 1 and 10,000", () => {
    expect(sliderToRows(0)).toBe(MIN_ROWS);
    expect(sliderToRows(100)).toBe(MAX_ROWS);
  });
  it("round-trips common values closely", () => {
    for (const rows of [1, 10, 50, 100, 500, 1000, 5000, 10000]) {
      const back = sliderToRows(rowsToSlider(rows));
      expect(Math.abs(back - rows) / rows).toBeLessThan(0.25);
    }
  });
  it("is monotonic", () => {
    let last = 0;
    for (let v = 0; v <= 100; v++) {
      const r = sliderToRows(v);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("formatting", () => {
  it("formats numbers and sizes", () => {
    expect(fmt(12345)).toBe("12,345");
    expect(bytes(512)).toBe("512 B");
    expect(bytes(2048)).toBe("2.0 KB");
    expect(bytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("SQL highlighting", () => {
  it("classifies keywords, strings, numbers and comments", () => {
    const [line] = highlight("INSERT INTO t (a) VALUES ('x', 42); -- done", "sql");
    const classes = Object.fromEntries((line ?? []).map((t) => [t.text.trim(), t.cls]));
    expect(classes.INSERT).toBe("keyword");
    expect(classes["'x'"]).toBe("string");
    expect(classes["42"]).toBe("number");
    expect(classes["-- done"]).toBe("comment");
  });
  it("carries a string across lines", () => {
    const lines = highlight("INSERT 'a\nb' + 1", "sql");
    expect(lines[1]?.[0]).toMatchObject({ text: "b'", cls: "string" });
    expect(lines[1]?.some((t) => t.cls === "number")).toBe(true);
  });
  it("handles E'' escapes and doubled quotes", () => {
    const [line] = highlight("E'it\\'s' 'a''b' 7", "sql");
    expect((line ?? []).filter((t) => t.cls === "string").map((t) => t.text).join("|")).toContain("E'it\\'s'");
    expect(line?.some((t) => t.cls === "number" && t.text === "7")).toBe(true);
  });
  it("highlights JSON and marks CSV headers and file separators", () => {
    expect(highlight('{"a": 1, "b": true}', "json")[0]?.map((t) => t.cls)).toEqual(expect.arrayContaining(["ident", "number", "keyword"]));
    const csv = highlight("# users.csv\nid,name\n1,Ada", "csv");
    expect(csv[0]?.[0]?.cls).toBe("comment");
    expect(csv[1]?.[0]?.cls).toBe("keyword");
    expect(csv[2]?.[0]?.cls).toBe("plain");
  });
});

describe("preview identity", () => {
  it("is the same for the same request regardless of table order, and differs when anything changes", () => {
    const a = requestKey(["b", "a"], DEFAULT_SETTINGS);
    expect(requestKey(["a", "b"], DEFAULT_SETTINGS)).toBe(a);
    expect(requestKey(["a", "b"], { ...DEFAULT_SETTINGS, seed: 43 })).not.toBe(a);
    expect(requestKey(["a"], DEFAULT_SETTINGS)).not.toBe(a);
  });
});
