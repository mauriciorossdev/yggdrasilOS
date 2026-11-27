// The one Dashboard of this machine: its widget instances (userData/dashboard.json)
// and their secrets, encrypted apart from them (userData/dashboard-secrets.json).
// Neither file is read by sync or settings export — sync is a later round, and
// secrets never travel (notes/features/dashboard.md).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";
import { WIDGET_SIZES, type WidgetSize } from "./widgetSpec.js";

export type WidgetInstance = {
  instanceId: string;
  /** PluginRecord.key — always "global:<id>". */
  pluginKey: string;
  title: string;
  size: WidgetSize;
  config: Record<string, unknown>;
  refreshSeconds: number;
  /** Hosts the person allowed for this instance; a new domain in an update has to be allowed again. */
  grantedDomains: string[];
};

/** Display order is array order. */
export type DashboardLayout = { instances: WidgetInstance[] };

/** A stored secret stays bound to the host it was typed for. */
export type StoredSecret = { value: string; domain: string };

const INSTANCE_ID_RE = /^[A-Za-z0-9:_-]{1,100}$/;

function filePath(name: string): string {
  return join(app.getPath("userData"), name);
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath(name), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[dashboard] ${name}:`, err);
    return fallback;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  const path = filePath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

// Read-modify-write of these files must not interleave (two windows, one app).
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export function sanitizeInstance(raw: unknown): WidgetInstance | null {
  const i = (raw && typeof raw === "object" ? raw : {}) as Partial<WidgetInstance>;
  if (typeof i.instanceId !== "string" || !INSTANCE_ID_RE.test(i.instanceId)) return null;
  if (typeof i.pluginKey !== "string" || !i.pluginKey.startsWith("global:")) return null;
  return {
    instanceId: i.instanceId,
    pluginKey: i.pluginKey,
    title: typeof i.title === "string" ? i.title.slice(0, 80) : "",
    size: WIDGET_SIZES.includes(i.size as WidgetSize) ? (i.size as WidgetSize) : "m",
    config: i.config && typeof i.config === "object" ? i.config : {},
    refreshSeconds: typeof i.refreshSeconds === "number" && i.refreshSeconds >= 0 ? i.refreshSeconds : 3600,
    grantedDomains: Array.isArray(i.grantedDomains) ? i.grantedDomains.filter((d) => typeof d === "string") : [],
  };
}

export async function readDashboard(): Promise<DashboardLayout> {
  const file = await readJson<{ instances?: unknown[] }>("dashboard.json", {});
  const instances = Array.isArray(file.instances) ? file.instances : [];
  return { instances: instances.flatMap((i) => sanitizeInstance(i) ?? []) };
}

export function writeDashboard(layout: DashboardLayout): Promise<DashboardLayout> {
  return serial(async () => {
    const instances = layout.instances.flatMap((i) => sanitizeInstance(i) ?? []);
    await writeJson("dashboard.json", { instances });
    // Secrets of removed instances go with them.
    const secrets = await readSecretsFile();
    const alive = new Set(instances.map((i) => i.instanceId));
    const orphans = Object.keys(secrets).filter((id) => !alive.has(id));
    if (orphans.length > 0) {
      for (const id of orphans) delete secrets[id];
      await writeJson("dashboard-secrets.json", secrets);
    }
    return { instances };
  });
}

/** instanceId -> field -> { domain, encrypted value (base64) }. */
type SecretsFile = Record<string, Record<string, { domain: string; data: string }>>;

function readSecretsFile(): Promise<SecretsFile> {
  return readJson<SecretsFile>("dashboard-secrets.json", {});
}

/**
 * Whether secrets can be stored encrypted. On Linux without a keyring,
 * safeStorage "encrypts" with a hardcoded password ("basic_text"): not stored.
 */
export function canStoreSecrets(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

export function saveSecrets(instanceId: string, values: Record<string, StoredSecret>): Promise<void> {
  return serial(async () => {
    if (Object.keys(values).length === 0) return;
    if (!canStoreSecrets()) throw new Error("no-encryption");
    const file = await readSecretsFile();
    const entry = (file[instanceId] ??= {});
    for (const [field, secret] of Object.entries(values)) {
      entry[field] = { domain: secret.domain, data: safeStorage.encryptString(secret.value).toString("base64") };
    }
    await writeJson("dashboard-secrets.json", file);
  });
}

export async function readSecret(instanceId: string, field: string): Promise<StoredSecret | undefined> {
  const stored = (await readSecretsFile())[instanceId]?.[field];
  if (!stored) return undefined;
  try {
    return { domain: stored.domain, value: safeStorage.decryptString(Buffer.from(stored.data, "base64")) };
  } catch (err) {
    console.error("[dashboard] secret could not be decrypted:", err);
    return undefined;
  }
}

/** Which fields of an instance have a saved secret, and for which host (never the value). */
export async function savedSecretFields(instanceId: string): Promise<Record<string, string>> {
  const entry = (await readSecretsFile())[instanceId] ?? {};
  return Object.fromEntries(Object.entries(entry).map(([field, s]) => [field, s.domain]));
}
