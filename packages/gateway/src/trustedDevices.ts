import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Devices (phones) the project owner has explicitly told the gateway to
 * stop asking for fs.* approval on — see methods.ts's requireFsApproval and
 * its five non-destructive call sites. Granted from ApprovalBar.tsx's
 * "Confiar en este dispositivo" checkbox, revoked from
 * PhoneLinkSection.tsx. Per-project on purpose (same scope fs approval
 * itself already has) — trusting a phone for one open project doesn't
 * silently trust it for every other one.
 */
export type TrustedDevice = {
  deviceId: string;
  trustedAt: string;
};

function trustedDevicesPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".yggdrasil", "trusted-devices.json");
}

export async function loadTrustedDevices(workspaceRoot: string): Promise<TrustedDevice[]> {
  try {
    const raw = JSON.parse(await readFile(trustedDevicesPath(workspaceRoot), "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as TrustedDevice[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function saveTrustedDevices(workspaceRoot: string, devices: TrustedDevice[]): Promise<void> {
  await mkdir(join(workspaceRoot, ".yggdrasil"), { recursive: true });
  await writeFile(trustedDevicesPath(workspaceRoot), JSON.stringify(devices, null, 2), "utf8");
}

export async function setDeviceTrusted(workspaceRoot: string, deviceId: string, trusted: boolean): Promise<void> {
  const existing = await loadTrustedDevices(workspaceRoot);
  const next = existing.filter((d) => d.deviceId !== deviceId);
  if (trusted) next.push({ deviceId, trustedAt: new Date().toISOString() });
  await saveTrustedDevices(workspaceRoot, next);
}

export async function isDeviceTrusted(workspaceRoot: string, deviceId: string): Promise<boolean> {
  const devices = await loadTrustedDevices(workspaceRoot);
  return devices.some((d) => d.deviceId === deviceId);
}
