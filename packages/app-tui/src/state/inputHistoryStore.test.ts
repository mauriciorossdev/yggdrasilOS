import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInputHistory, MAX_INPUT_HISTORY, mergeInputHistory, saveInputHistory } from "./inputHistoryStore.js";

async function tmpFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "ygg-tui-hist-")), "nested", "history.json");
}

describe("input history store", () => {
  it("round-trips, creating the directory", async () => {
    const path = await tmpFile();
    await saveInputHistory(["a", "b"], path);
    expect(await loadInputHistory(path)).toEqual(["a", "b"]);
  });

  it("treats a missing or corrupt file as empty", async () => {
    const path = await tmpFile();
    expect(await loadInputHistory(path)).toEqual([]);
    await saveInputHistory(["x"], path);
    await writeFile(path, "{not json");
    expect(await loadInputHistory(path)).toEqual([]);
  });

  it("keeps only the newest entries", async () => {
    const path = await tmpFile();
    const many = Array.from({ length: MAX_INPUT_HISTORY + 20 }, (_, i) => `m${i}`);
    await saveInputHistory(many, path);
    const loaded = await loadInputHistory(path);
    expect(loaded).toHaveLength(MAX_INPUT_HISTORY);
    expect(loaded.at(-1)).toBe(`m${MAX_INPUT_HISTORY + 19}`);
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveLength(MAX_INPUT_HISTORY);
  });

  it("drops non-string entries", async () => {
    const path = await tmpFile();
    await saveInputHistory(["ok"], path);
    await writeFile(path, JSON.stringify(["ok", 3, null, "", "also ok"]));
    expect(await loadInputHistory(path)).toEqual(["ok", "also ok"]);
  });
});

describe("mergeInputHistory", () => {
  it("appends this session after what was persisted, skipping a repeated boundary", () => {
    expect(mergeInputHistory(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeInputHistory([], ["x"])).toEqual(["x"]);
  });
});
