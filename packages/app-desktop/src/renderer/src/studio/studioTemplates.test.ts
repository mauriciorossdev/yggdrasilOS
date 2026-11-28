import { describe, expect, it } from "vitest";
import { isWidgetTemplate, STUDIO_TEMPLATES, WIDGET_TEMPLATES, slugify, suggestName, uniqueId } from "./studioTemplates.js";

describe("suggestName", () => {
  it("drops leading articles and keeps three words, capitalized", () => {
    expect(suggestName("Una checklist de pasos para lanzar una versión")).toBe("Checklist de pasos");
    expect(suggestName("the board for tasks of the project")).toBe("Board for tasks");
  });

  it("never ends on a connector word", () => {
    expect(suggestName("Un contador simple con boton para sumar")).toBe("Contador simple");
    expect(suggestName("a board for the team")).toBe("Board");
  });

  it("names a widget after what it shows", () => {
    expect(suggestName("Un widget con los repos destacados de GitHub")).toBe("Repos destacados");
    expect(suggestName("widget de clima")).toBe("Clima");
    expect(suggestName("widget")).toBe("Widget");
  });

  it("ignores punctuation and emoji", () => {
    expect(suggestName("¡Un tablero! 🚀 de tareas")).toBe("Tablero de tareas");
  });

  it("returns empty for an empty description", () => {
    expect(suggestName("   ")).toBe("");
  });
});

describe("slugify", () => {
  it("lowercases, strips accents and joins with hyphens", () => {
    expect(slugify("Visor de Archivos — Versión 2")).toBe("visor-de-archivos-version-2");
  });

  it("falls back when nothing usable is left", () => {
    expect(slugify("🚀🚀")).toBe("complemento");
  });

  it("stays a valid plugin id (≤64 chars)", () => {
    expect(slugify("a".repeat(100))).toHaveLength(64);
  });
});

describe("uniqueId", () => {
  it("keeps the base when free, otherwise numbers it", () => {
    expect(uniqueId("tareas", new Set())).toBe("tareas");
    expect(uniqueId("tareas", new Set(["tareas", "tareas-2"]))).toBe("tareas-3");
  });
});

describe("STUDIO_TEMPLATES", () => {
  it("has six templates with unique ids and at least one view each", () => {
    expect(STUDIO_TEMPLATES).toHaveLength(6);
    expect(new Set(STUDIO_TEMPLATES.map((t) => t.id)).size).toBe(6);
    for (const t of STUDIO_TEMPLATES) expect(t.views.length).toBeGreaterThan(0);
  });
});

describe("WIDGET_TEMPLATES", () => {
  it("offers list, number and chart, all widget-only and distinct from the others", () => {
    expect(WIDGET_TEMPLATES.map((t) => t.id)).toEqual(["widgetList", "widgetNumber", "widgetChart"]);
    for (const t of WIDGET_TEMPLATES) {
      expect(t.views).toEqual(["widget"]);
      expect(isWidgetTemplate(t)).toBe(true);
    }
    for (const t of STUDIO_TEMPLATES) expect(isWidgetTemplate(t)).toBe(false);
  });
});
