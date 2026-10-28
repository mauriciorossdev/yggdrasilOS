import { Socket } from "node:net";

/** Ports dev servers commonly default to (Next/Vite/CRA/Astro/Angular/Storybook/Hugo/http servers...). */
export const COMMON_DEV_PORTS = [
  1313, 3000, 3001, 3002, 3030, 4173, 4200, 4321, 5000, 5173, 5174, 6006, 8000, 8080, 8081, 8888, 9000,
];

/** True if something accepts a TCP connection on host:port within `timeoutMs`. */
export function probePort(port: number, host = "127.0.0.1", timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

/** The subset of `ports` currently listening on this machine, ascending. */
export async function scanLocalPorts(
  ports: number[] = COMMON_DEV_PORTS,
  host = "127.0.0.1",
  timeoutMs = 250,
): Promise<number[]> {
  const results = await Promise.all(ports.map(async (port) => ((await probePort(port, host, timeoutMs)) ? port : null)));
  return results.filter((p): p is number => p !== null).sort((a, b) => a - b);
}
