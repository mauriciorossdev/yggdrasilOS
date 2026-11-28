import { describe, expect, it } from "vitest";
import { parseWidgetSpec } from "./widgetSpec.js";
import { STARTER_WIDGET_JS, starterWidgetBlock } from "./widgetStarter.js";

describe("widget starter", () => {
  it("is a valid widget block that keeps the chosen size", () => {
    expect(parseWidgetSpec(starterWidgetBlock("l"), [])).toMatchObject({ defaultSize: "l", fields: [] });
  });

  it("ships a script that parses", () => {
    expect(() => new Function(STARTER_WIDGET_JS)).not.toThrow();
  });
});
