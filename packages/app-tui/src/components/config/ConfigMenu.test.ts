import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfigMenu } from "./ConfigMenu.js";

const tick = () => new Promise((r) => setTimeout(r, 90));
const ESC = "\u001B";
const ENTER = "\r";
const DOWN = "\u001B[B";

const providers = [
  { id: "a", label: "Alpha", models: [{ id: "a1", label: "A One", provider: "a" }, { id: "a2", label: "A Two", provider: "a" }] },
  { id: "b", label: "Beta", models: [{ id: "b1", label: "B One", provider: "b" }] },
];
const config = { agents: [{ id: "default", provider: "a", model: "a1" }] };

function setup(opts: { initialView?: { view: "model"; providerId?: string } } = {}) {
  const onClose = vi.fn();
  const onNotice = vi.fn();
  const onConfigChanged = vi.fn();
  const call = vi.fn(async () => ({ ok: true, requiresRestart: false }));
  const app = render(
    React.createElement(ConfigMenu, {
      client: { call } as never,
      providers,
      config,
      agentId: "default",
      onClose,
      onConfigChanged,
      onNotice,
      initialView: opts.initialView,
    }),
  );
  const press = async (key: string) => {
    app.stdin.write(key);
    await tick();
  };
  return { app, press, onClose, onNotice, onConfigChanged, call, frame: () => app.lastFrame() ?? "" };
}

describe("ConfigMenu opened from /model", () => {
  it("esc goes straight back to the chat", async () => {
    const t = setup({ initialView: { view: "model", providerId: "a" } });
    await tick();
    expect(t.frame()).toContain("Select Model");
    await t.press(ESC);
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it("p switches provider, then returns to the model list of the new one", async () => {
    const t = setup({ initialView: { view: "model", providerId: "a" } });
    await tick();
    expect(t.frame()).toContain("p change provider");
    await t.press("p");
    expect(t.frame()).toContain("Select Provider");
    await t.press(DOWN);
    await t.press(ENTER);
    expect(t.frame()).toContain("Beta — Select Model");
    expect(t.onClose).not.toHaveBeenCalled();
    await t.press(ESC);
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it("esc from the provider list returns to the model list instead of closing", async () => {
    const t = setup({ initialView: { view: "model", providerId: "a" } });
    await tick();
    await t.press("p");
    await t.press(ESC);
    expect(t.frame()).toContain("Alpha — Select Model");
    expect(t.onClose).not.toHaveBeenCalled();
  });

  it("choosing a model saves it, reports in the chat and closes", async () => {
    const t = setup({ initialView: { view: "model", providerId: "a" } });
    await tick();
    await t.press(DOWN);
    await t.press(ENTER);
    expect(t.call).toHaveBeenCalledWith("config.patch", {
      agents: [{ id: "default", provider: "a", model: "a2" }],
    });
    expect(t.onNotice).toHaveBeenCalledWith("✓ Model set to a2");
    expect(t.onClose).toHaveBeenCalledTimes(1);
    expect(t.onConfigChanged).toHaveBeenCalled();
  });

  it("reports a failed save in the chat as well", async () => {
    const t = setup({ initialView: { view: "model", providerId: "a" } });
    t.call.mockRejectedValueOnce(new Error("disk full"));
    await tick();
    await t.press(ENTER);
    expect(t.onNotice).toHaveBeenCalledWith("✗ disk full");
    expect(t.onClose).toHaveBeenCalled();
  });
});

describe("ConfigMenu opened from /config", () => {
  it("esc at the root closes the menu", async () => {
    const t = setup();
    await tick();
    expect(t.frame()).toContain("esc back to chat");
    await t.press(ESC);
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it("walks back one screen at a time: model → provider → root → chat", async () => {
    const t = setup();
    await tick();
    await t.press(ENTER); // Provider
    expect(t.frame()).toContain("Select Provider");
    await t.press(ENTER); // pick Alpha → models
    expect(t.frame()).toContain("Alpha — Select Model");
    await t.press(ESC);
    expect(t.frame()).toContain("Select Provider");
    await t.press(ESC);
    expect(t.frame()).toContain("Configuration");
    expect(t.onClose).not.toHaveBeenCalled();
    await t.press(ESC);
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it("after choosing a model it returns to the menu with the result shown", async () => {
    const t = setup();
    await tick();
    await t.press(ENTER);
    await t.press(ENTER);
    await t.press(DOWN);
    await t.press(ENTER);
    expect(t.frame()).toContain("✓ Model set to a2");
    expect(t.frame()).toContain("Provider");
    expect(t.onClose).not.toHaveBeenCalled();
    expect(t.onNotice).not.toHaveBeenCalled();
  });
});
