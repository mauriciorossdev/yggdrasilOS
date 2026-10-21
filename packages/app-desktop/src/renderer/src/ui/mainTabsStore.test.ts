import { describe, expect, it } from "vitest";
import { MAIN_TAB_LABELS, resolveActiveTab, viewLabel } from "./mainTabsStore.js";

describe("resolveActiveTab", () => {
  it("keeps a valid tab", () => {
    expect(resolveActiveTab("terminal", [], false)).toBe("terminal");
    expect(resolveActiveTab("plugin:project:kanban", ["plugin:project:kanban"], false)).toBe("plugin:project:kanban");
  });

  it("falls back to chat when a complemento tab was closed", () => {
    expect(resolveActiveTab("plugin:project:kanban", [], false)).toBe("chat");
  });

  it("only the main window has Home", () => {
    expect(resolveActiveTab("home", [], true)).toBe("home");
    expect(resolveActiveTab("home", [], false)).toBe("chat");
  });
});

describe("viewLabel", () => {
  it("labels builtin and complemento tabs", () => {
    expect(viewLabel("repository", [])).toBe(MAIN_TAB_LABELS.repository);
    expect(viewLabel("plugin:global:x", [{ id: "plugin:global:x", label: "Kanban", onClose: () => {} }])).toBe("Kanban");
    expect(viewLabel("plugin:global:gone", [])).toBe("Complemento");
  });
});
