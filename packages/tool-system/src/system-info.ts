import os from "node:os";
import { defineTool } from "@yggdrasil/tools-sdk";

export const systemInfoTool = defineTool({
  name: "system_info",
  description: "Returns system specs: OS platform/arch/release, hostname, CPU info, memory, uptime, Node.js version.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    const cpus = os.cpus();
    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model ?? "unknown",
      cpuCount: cpus.length,
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      uptimeSeconds: os.uptime(),
      nodeVersion: process.version,
    };
  },
});
