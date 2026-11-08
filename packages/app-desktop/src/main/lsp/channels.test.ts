import { createServer, type AddressInfo, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { openChannel } from "./channels.js";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

function listen(onConnect: (socket: import("node:net").Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(onConnect);
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as AddressInfo).port));
  });
}

describe("tcp channel", () => {
  it("exchanges data with a server it doesn't own", async () => {
    const port = await listen((socket) => socket.on("data", (d) => socket.write(`echo:${d.toString()}`)));
    const channel = openChannel({ kind: "tcp", host: "127.0.0.1", port }, ".");
    expect(channel.ownsServer).toBe(false);
    const received = new Promise<string>((resolve) => channel.onData((chunk) => resolve(chunk.toString())));
    channel.write(Buffer.from("hi"));
    expect(await received).toBe("echo:hi");
    channel.kill();
  });

  it("reports a refused connection, for when the editor isn't open", async () => {
    const port = await listen(() => {});
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    const channel = openChannel({ kind: "tcp", host: "127.0.0.1", port }, ".");
    const reason = await new Promise<string | null>((resolve) => channel.onClose(resolve));
    expect(reason).toMatch(/ECONNREFUSED/);
  });

  it("reports the server going away", async () => {
    const port = await listen((socket) => socket.end());
    const channel = openChannel({ kind: "tcp", host: "127.0.0.1", port }, ".");
    channel.onData(() => {});
    await new Promise<string | null>((resolve) => channel.onClose(resolve));
  });
});
