import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";
import { initialState } from "../state/store.js";

const show = (over: Partial<ReturnType<typeof initialState>>) =>
  render(React.createElement(StatusBar, { state: { ...initialState(), connected: true, ...over } })).lastFrame() ?? "";

describe("StatusBar", () => {
  it("shows the running state while a turn runs", () => {
    expect(show({ isTurnActive: true })).toContain("thinking");
  });
  it("says cancelling once the user asked", () => {
    const frame = show({ isTurnActive: true, isCancelling: true });
    expect(frame).toContain("cancelling");
    expect(frame).not.toContain("thinking");
  });
  it("shows neither when idle", () => {
    const frame = show({});
    expect(frame).not.toContain("cancelling");
    expect(frame).not.toContain("thinking");
  });
  it("tells the user the provider is retrying, instead of looking frozen", () => {
    const frame = show({ isTurnActive: true, retryNotice: { attempt: 2, delayMs: 4000, reason: "HTTP 500" } });
    expect(frame).toContain("retrying in 4s");
    expect(frame).toContain("HTTP 500");
    expect(frame).not.toContain("thinking");
  });
});
