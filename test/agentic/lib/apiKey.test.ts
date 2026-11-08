import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findApiKey } from "./apiKey.js";

const tmpFile = (content: string, mode = 0o600) => {
  const path = join(mkdtempSync(join(tmpdir(), "ygg-key-")), "key");
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
};

describe("findApiKey", () => {
  it("prefers the environment, EVAL_OLLAMA_API_KEY over OLLAMA_API_KEY", () => {
    expect(findApiKey({ EVAL_OLLAMA_API_KEY: "a", OLLAMA_API_KEY: "b" }, "/nope")).toEqual({ key: "a", source: "env" });
    expect(findApiKey({ OLLAMA_API_KEY: " b " }, "/nope")).toEqual({ key: "b", source: "env" });
  });

  it("reads the key file and trims the trailing newline", () => {
    const file = tmpFile("from-file\n");
    expect(findApiKey({}, file)).toEqual({ key: "from-file", source: "file", warning: undefined });
    expect(findApiKey({ EVAL_OLLAMA_API_KEY_FILE: file }, "/nope").key).toBe("from-file");
  });

  it("warns when the file is readable by others", () => {
    expect(findApiKey({}, tmpFile("k", 0o644)).warning).toMatch(/chmod 600/);
  });

  it("treats a missing default file or an empty one as no key, but a named file that is missing as an error", () => {
    expect(findApiKey({}, "/does/not/exist")).toEqual({});
    expect(findApiKey({}, tmpFile("  \n"))).toEqual({});
    expect(() => findApiKey({ EVAL_OLLAMA_API_KEY_FILE: "/does/not/exist" }, "/nope")).toThrow(/cannot be read/);
  });
});
