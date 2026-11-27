// The only way out to the internet for a dashboard widget. Runs in main: the
// widget names a URL, and this checks the grant, adds the secret, and caches
// the answer per instance so reopening the app doesn't spend API quota.
import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { checkUrl, isPublicAddress, NetError } from "./netGuard.js";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 4;

export type FetchSecret = { header: string; prefix?: string; value: string; domain: string };

export type NetRequest = {
  url: string;
  /** Hosts this instance may reach: manifest permissions the person allowed. */
  allowed: string[];
  secret?: FetchSecret;
};

export type NetResponse = { status: number; ok: boolean; body: string };

export type CachedResponse = NetResponse & { fetchedAt: number; cached: boolean };

/**
 * Resolves and checks in the same step the socket uses, so a DNS answer can't
 * change between the check and the connection (rebinding).
 */
function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new NetError("blocked-address", `${hostname} resuelve a una dirección no pública`), []);
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

type RawResponse = NetResponse & { location?: string };

function once(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    // An IP literal never goes through `lookup`.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !isPublicAddress(literal)) return reject(new NetError("blocked-address", literal));
    const req = request(url, { method: "GET", headers, lookup: guardedLookup, signal, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) req.destroy(new NetError("too-large", "la respuesta supera 1 MB"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300, body: Buffer.concat(chunks).toString("utf8"), location: res.headers.location });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

export async function guardedFetch({ url, allowed, secret }: NetRequest): Promise<NetResponse> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let target = checkUrl(url, allowed);
  if (secret && target.hostname !== secret.domain) throw new NetError("not-granted", `esa clave es solo para ${secret.domain}`);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = { "User-Agent": "Yggdrasil-Dashboard", Accept: "application/json, */*" };
      // Re-decided on every hop: the secret never follows a redirect to another host.
      if (secret && target.hostname === secret.domain) headers[secret.header] = `${secret.prefix ?? ""}${secret.value}`;
      const res = await once(target, headers, signal);
      if (res.status >= 300 && res.status < 400 && res.location) {
        target = checkUrl(new URL(res.location, target).toString(), allowed);
        continue;
      }
      // An API that echoes the key back must not hand it to the widget.
      const body = secret && secret.value.length >= 8 ? res.body.split(secret.value).join("[secret]") : res.body;
      return { status: res.status, ok: res.ok, body };
    }
  } catch (err) {
    if (err instanceof NetError) throw err;
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof NetError) throw cause;
    if (signal.aborted) throw new NetError("timeout", "sin respuesta a tiempo");
    throw new NetError("network", err instanceof Error ? err.message : String(err));
  }
  throw new NetError("network", "demasiadas redirecciones");
}

type Entry = NetResponse & { fetchedAt: number; stale?: boolean };
/** instanceId -> request key -> last good answer. */
type CacheFile = Record<string, Record<string, Entry>>;

const MAX_ENTRIES_PER_INSTANCE = 20;

export type WidgetCache = ReturnType<typeof createWidgetCache>;

/**
 * Last good answer per instance and request. Only successful answers are kept,
 * each overwritten by the next one. `fetcher` and `now` are injectable for tests.
 */
export function createWidgetCache(path: string, fetcher: (req: NetRequest) => Promise<NetResponse> = guardedFetch, now = Date.now) {
  let loaded: Promise<CacheFile> | undefined;
  let writing: Promise<unknown> = Promise.resolve();
  const inFlight = new Map<string, Promise<CachedResponse>>();

  const load = (): Promise<CacheFile> =>
    (loaded ??= readFile(path, "utf8")
      .then((raw) => JSON.parse(raw) as CacheFile)
      .catch(() => ({})));

  const persist = (file: CacheFile): void => {
    writing = writing
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
      })
      .catch((err) => console.error("[dashboard] cache write failed:", err));
  };

  return {
    /** `intervalSeconds` 0 keeps an answer until `invalidate`. */
    async fetch(instanceId: string, intervalSeconds: number, req: NetRequest): Promise<CachedResponse> {
      // A revoked grant must not be answered from the cache.
      checkUrl(req.url, req.allowed);
      const key = createHash("sha256")
        .update(JSON.stringify([req.url, req.secret?.header, req.secret?.value]))
        .digest("hex");
      const file = await load();
      const hit = file[instanceId]?.[key];
      if (hit && !hit.stale && (intervalSeconds === 0 || now() - hit.fetchedAt < intervalSeconds * 1000)) {
        return { status: hit.status, ok: hit.ok, body: hit.body, fetchedAt: hit.fetchedAt, cached: true };
      }
      const flight = `${instanceId} ${key}`;
      let pending = inFlight.get(flight);
      if (!pending) {
        pending = fetcher(req)
          .then((res) => {
            const fetchedAt = now();
            if (res.ok) {
              const entries = (file[instanceId] ??= {});
              entries[key] = { ...res, fetchedAt };
              const old = Object.entries(entries).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(MAX_ENTRIES_PER_INSTANCE);
              for (const [k] of old) delete entries[k];
              persist(file);
            }
            return { ...res, fetchedAt, cached: false };
          })
          .finally(() => inFlight.delete(flight));
        inFlight.set(flight, pending);
      }
      return pending;
    },
    /** The next fetch of this instance goes to the network (manual refresh). */
    async invalidate(instanceId: string): Promise<void> {
      const file = await load();
      for (const entry of Object.values(file[instanceId] ?? {})) entry.stale = true;
      persist(file);
    },
    /** A new instance starts with what its configure preview already fetched. */
    async adopt(from: string, to: string): Promise<void> {
      const file = await load();
      if (!file[from]) return;
      file[to] = { ...file[to], ...file[from] };
      delete file[from];
      persist(file);
    },
    /** Drops everything but these instances (removed widgets, closed previews). */
    async retain(keep: (instanceId: string) => boolean): Promise<void> {
      const file = await load();
      for (const id of Object.keys(file)) if (!keep(id)) delete file[id];
      persist(file);
    },
    /** Test hook: resolves once pending writes are on disk. */
    flush: (): Promise<unknown> => writing,
  };
}
