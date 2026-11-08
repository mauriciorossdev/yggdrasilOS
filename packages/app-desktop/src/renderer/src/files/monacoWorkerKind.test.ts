import { describe, expect, it } from "vitest";
import { monacoWorkerKind } from "./monacoWorkerKind.js";

describe("monacoWorkerKind", () => {
  it("sends each language service to its own worker", () => {
    expect(monacoWorkerKind("typescript")).toBe("typescript");
    expect(monacoWorkerKind("javascript")).toBe("typescript");
    expect(monacoWorkerKind("json")).toBe("json");
    expect(monacoWorkerKind("scss")).toBe("css");
    expect(monacoWorkerKind("less")).toBe("css");
    expect(monacoWorkerKind("handlebars")).toBe("html");
  });

  it("uses the generic worker for anything else", () => {
    expect(monacoWorkerKind("editorWorkerService")).toBe("editor");
    expect(monacoWorkerKind("python")).toBe("editor");
  });
});
