import { describe, expect, it } from "vitest";
import { clampRefresh, netDomains, parseWidgetSpec, refreshChoices } from "./widgetSpec.js";

const secret = { type: "secret", title: "Key", domain: "api.example.com", sendAs: { header: "X-Api-Key" } };
const withFields = (properties: Record<string, unknown>) => ({ configSchema: { type: "object", properties } });

describe("netDomains", () => {
  it("keeps only exact public host names", () => {
    expect(
      netDomains(["fs", "net:api.github.com", "net:api.github.com", "net:*.github.com", "net:localhost", "net:10.0.0.1", "net:printer.local", "net:a.com/path"]),
    ).toEqual(["api.github.com"]);
  });
});

describe("parseWidgetSpec", () => {
  it("fills defaults for an empty block", () => {
    expect(parseWidgetSpec(undefined, [])).toEqual({ defaultSize: "m", refresh: { minSeconds: 900, defaultSeconds: 3600 }, fields: [] });
  });

  it("reads every field type", () => {
    const spec = parseWidgetSpec(
      withFields({
        a: { type: "string" },
        b: { type: "integer", default: 3 },
        c: { type: "boolean" },
        d: { type: "string", enum: ["x", "y"] },
        e: secret,
      }),
      ["net:api.example.com"],
    );
    expect(spec.fields.map((f) => f.type)).toEqual(["text", "number", "bool", "list", "secret"]);
    expect(spec.fields[4]).toMatchObject({ domain: "api.example.com", header: "X-Api-Key", required: true });
  });

  it("never lets a manifest refresh faster than every 15 minutes", () => {
    const spec = parseWidgetSpec({ refresh: { minSeconds: 1, defaultSeconds: 5 } }, []);
    expect(spec.refresh).toEqual({ minSeconds: 900, defaultSeconds: 900 });
    expect(clampRefresh(1, spec)).toBe(900);
    expect(clampRefresh(0, spec)).toBe(0);
  });

  it("hides choices faster than the minimum", () => {
    expect(refreshChoices(parseWidgetSpec({ refresh: { minSeconds: 3600 } }, []))).toEqual([3600, 21600, 86400, 0]);
  });

  it("rejects a secret bound to a domain without permission, or a dangerous header", () => {
    expect(() => parseWidgetSpec(withFields({ k: secret }), [])).toThrow(/net:/);
    expect(() => parseWidgetSpec(withFields({ k: { ...secret, sendAs: { header: "Host" } } }), ["net:api.example.com"])).toThrow(/sendAs/);
    expect(() => parseWidgetSpec(withFields({ k: { type: "color" } }), [])).toThrow(/desconocido/);
  });
});
