/**
 * Which editor is open for a file, so something outside it (an agent's tool call) can act on it. A tool call
 * may arrive before the editor has finished opening, so callers can wait for it — and are told at once if the
 * file can't be opened instead of waiting for a timeout.
 */
type Waiter<T> = { resolve: (c: T) => void; reject: (e: Error) => void };

export function createControllerRegistry<T>(label: string) {
  const controllers = new Map<string, T>();
  const waiters = new Map<string, Set<Waiter<T>>>();

  return {
    /** The editor for `path` calls this once it is ready; the returned function unregisters it. */
    register(path: string, controller: T): () => void {
      controllers.set(path, controller);
      waiters.get(path)?.forEach((w) => w.resolve(controller));
      waiters.delete(path);
      return () => {
        if (controllers.get(path) === controller) controllers.delete(path);
      };
    },
    get: (path: string): T | undefined => controllers.get(path),
    /** The editor could not open `path`: whoever is waiting for it fails now, with the real reason. */
    failOpen(path: string, error: Error): void {
      waiters.get(path)?.forEach((w) => w.reject(error));
      waiters.delete(path);
    },
    /** Resolves when the editor for `path` is ready (at once if it already is); rejects if it fails to open or after `timeoutMs`. */
    whenReady(path: string, timeoutMs = 20_000): Promise<T> {
      const existing = controllers.get(path);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const set = waiters.get(path) ?? new Set<Waiter<T>>();
        waiters.set(path, set);
        const timer = setTimeout(() => {
          set.delete(waiter);
          reject(new Error(`The ${label} "${path}" did not finish opening in time`));
        }, timeoutMs);
        const waiter: Waiter<T> = {
          resolve: (c) => (clearTimeout(timer), resolve(c)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        };
        set.add(waiter);
      });
    },
    reset(): void {
      controllers.clear();
      waiters.clear();
    },
  };
}
