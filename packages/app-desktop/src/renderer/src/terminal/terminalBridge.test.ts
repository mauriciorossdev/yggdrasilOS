import { describe, expect, it, vi } from "vitest";
import { notifyTerminalTabVisible, onTerminalTabVisible } from "./terminalBridge.js";

describe("onTerminalTabVisible", () => {
  it("tells every subscriber, not only the last one to subscribe", () => {
    const refit = vi.fn();
    const refetchTeams = vi.fn();
    const offRefit = onTerminalTabVisible(refit);
    const offTeams = onTerminalTabVisible(refetchTeams);

    notifyTerminalTabVisible();
    expect(refit).toHaveBeenCalledTimes(1);
    expect(refetchTeams).toHaveBeenCalledTimes(1);

    offRefit();
    offTeams();
  });

  it("unsubscribing one leaves the others", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onTerminalTabVisible(a);
    const offB = onTerminalTabVisible(b);

    offA();
    notifyTerminalTabVisible();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);

    offB();
    notifyTerminalTabVisible();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("a subscriber that unsubscribes while being notified doesn't skip the next one", () => {
    const calls: string[] = [];
    const offFirst = onTerminalTabVisible(() => {
      calls.push("first");
      offFirst();
    });
    const offSecond = onTerminalTabVisible(() => calls.push("second"));

    notifyTerminalTabVisible();
    expect(calls).toEqual(["first", "second"]);

    offSecond();
  });
});
