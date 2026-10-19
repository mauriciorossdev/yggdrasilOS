import { describe, it, expect, vi, afterEach } from "vitest";
import { setDeviceToolInvoker } from "@yggdrasil/tools-runtime";
import { phoneToolExecutor } from "./phoneTool.js";

function run(params: Record<string, unknown>) {
  return phoneToolExecutor({
    node: {} as never,
    params,
    exprCtx: {} as never,
    signal: new AbortController().signal,
    workflow: {} as never,
    nodeExecutors: {},
    deviceEvents: "fake-events-bus",
  });
}

describe("phoneToolExecutor", () => {
  afterEach(() => {
    setDeviceToolInvoker(null);
  });

  it("throws when `deviceId` is missing", async () => {
    setDeviceToolInvoker(vi.fn());
    await expect(run({ tool: "phone_open_app" })).rejects.toThrow(/deviceId/);
  });

  it("throws when `tool` is missing", async () => {
    setDeviceToolInvoker(vi.fn());
    await expect(run({ deviceId: "phone-1" })).rejects.toThrow(/tool/);
  });

  it("throws a clear error when no invoker is registered on this gateway", async () => {
    await expect(run({ deviceId: "phone-1", tool: "phone_open_app" })).rejects.toThrow(/no device-tool invoker registered/);
  });

  it("calls the registered invoker with deviceId/tool/args and returns its result as output", async () => {
    const invoker = vi.fn().mockResolvedValue({ opened: true });
    setDeviceToolInvoker(invoker);

    const result = await run({ deviceId: "phone-1", tool: "phone_open_app", args: { app: "Calculator" } });

    expect(invoker).toHaveBeenCalledWith("fake-events-bus", "phone-1", "phone_open_app", { app: "Calculator" });
    expect(result).toEqual({ handle: "out", output: { opened: true } });
  });

  it("defaults `args` to an empty object when not provided", async () => {
    const invoker = vi.fn().mockResolvedValue({});
    setDeviceToolInvoker(invoker);

    await run({ deviceId: "phone-1", tool: "phone_list_installed_apps" });

    expect(invoker).toHaveBeenCalledWith("fake-events-bus", "phone-1", "phone_list_installed_apps", {});
  });

  it("propagates a device_offline error from the invoker unchanged", async () => {
    setDeviceToolInvoker(vi.fn().mockRejectedValue(new Error('device_offline: no connected device with id "phone-1"')));
    await expect(run({ deviceId: "phone-1", tool: "phone_open_app" })).rejects.toThrow(/device_offline/);
  });
});
