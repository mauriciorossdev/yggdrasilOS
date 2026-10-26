import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probePort, scanLocalPorts } from "./localPorts.js";

const servers: Server[] = [];

function listen(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

/** A port that was free a moment ago: listen, note it, close. */
async function freePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
  );
  await new Promise((resolve) => server.close(resolve));
  return port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("probePort", () => {
  it("is true for a listening port and false for a closed one", async () => {
    const open = await listen();
    const closed = await freePort();
    expect(await probePort(open)).toBe(true);
    expect(await probePort(closed)).toBe(false);
  });
});

describe("scanLocalPorts", () => {
  it("returns only the listening ports, sorted", async () => {
    const a = await listen();
    const b = await listen();
    const closed = await freePort();
    expect(await scanLocalPorts([Math.max(a, b), closed, Math.min(a, b)])).toEqual([Math.min(a, b), Math.max(a, b)]);
  });

  it("returns nothing when nothing listens", async () => {
    expect(await scanLocalPorts([await freePort()])).toEqual([]);
  });
});
