import { createServer } from "node:net";

export async function allocatePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function allocatePorts(count: number, host = "127.0.0.1"): Promise<number[]> {
  const ports: number[] = [];
  for (let i = 0; i < count; i++) {
    ports.push(await allocatePort(host));
  }
  return ports;
}
