/**
 * Retrying transient failures of the chat request: a rate limit, a 5xx from the server, or a connection that
 * dropped. A cloud endpoint throws these now and then (an HTTP 500 mid-run ended whole agent turns in the evals);
 * a plain "fail and tell the model" turns a blip into a lost turn. Only the *request* is retried — never a
 * response that already started streaming, which would repeat text the user has seen.
 */

export type RetryOptions = {
  /** Retries after the first attempt. 0 turns retrying off. Default 10 (what Claude Code allows per request). */
  maxRetries?: number;
  /** First wait, doubled each time (with jitter) up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Test hooks. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Told before each wait, e.g. to log it. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
};

export const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
/** A server asking for a very long wait is not worth blocking a turn for. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Statuses worth another try: rate limited, request timeout, and the server-side errors that are often momentary. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
}

// Dropped or stalled connections. ECONNREFUSED / ENOTFOUND are deliberately absent: nothing is listening or the
// host name is wrong, and waiting will not fix that (a stopped local Ollama should fail fast).
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);

export function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  const code = (err as { code?: string }).code ?? ((err as { cause?: { code?: string } }).cause?.code);
  if (code) return RETRYABLE_CODES.has(code);
  // undici reports a dropped connection as a bare TypeError("fetch failed") with the reason in `cause`; without a
  // known code it is still more likely a blip than a misconfiguration.
  return err.name === "TypeError" && /fetch failed|terminated/i.test(err.message);
}

/** `Retry-After` is either seconds or an HTTP date. Returns milliseconds, or undefined when absent or unusable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

/** Exponential backoff with ±25 % jitter; a Retry-After from the server wins when it asks for longer. */
export function backoffDelay(attempt: number, options: RetryOptions, retryAfterMs?: number): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const exponential = Math.min(base * 2 ** (attempt - 1), max);
  const jittered = exponential * (0.75 + random() * 0.5);
  return Math.round(Math.max(jittered, retryAfterMs ?? 0));
}

/** Resolves after `ms`, or rejects at once if the signal aborts (a cancelled turn must not sit out the wait). */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * `send` performs one attempt and returns the Response (any status). 2xx and non-retryable statuses are handed
 * back to the caller; retryable statuses and network errors are retried up to maxRetries, after which the last
 * response is returned (so the caller reports the real status) or the last network error is thrown.
 */
export async function sendWithRetry(send: () => Promise<Response>, options: RetryOptions, signal?: AbortSignal): Promise<Response> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const sleep = options.sleep ?? abortableSleep;

  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    let error: unknown;
    try {
      response = await send();
    } catch (err) {
      if (signal?.aborted || !isRetryableNetworkError(err)) throw err;
      error = err;
    }

    const retryable = response ? isRetryableStatus(response.status) : true;
    if (!retryable) return response!;
    if (attempt > maxRetries) {
      if (response) return response;
      throw error;
    }

    const retryAfter = response ? parseRetryAfter(response.headers.get("retry-after")) : undefined;
    const delayMs = backoffDelay(attempt, options, retryAfter);
    options.onRetry?.({ attempt, delayMs, reason: response ? `HTTP ${response.status}` : error instanceof Error ? error.message : String(error) });
    // The failed response's body is never read; free the connection before waiting.
    await response?.body?.cancel().catch(() => {});
    await sleep(delayMs, signal);
  }
}
