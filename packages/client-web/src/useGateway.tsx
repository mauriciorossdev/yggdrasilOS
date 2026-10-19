import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API_KEY_STORAGE, defaultWsUrl, GatewayClient, type GatewayWsEvent } from "./gateway-client.js";

type Health = {
  ok: boolean;
  version?: string;
  authRequired?: boolean;
  ui?: boolean;
};

type GatewayContextValue = {
  connected: boolean;
  authenticated: boolean;
  health: Health | null;
  connect: (apiKey?: string) => Promise<void>;
  call: <T>(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<T>;
  callWithEvents: <T>(
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<{ result: T; events: GatewayWsEvent[] }>;
  onEvent: (handler: (ev: GatewayWsEvent) => void) => () => void;
  disconnect: () => void;
};

const GatewayContext = createContext<GatewayContextValue | null>(null);

export function GatewayProvider({
  children,
  wsUrl,
}: {
  children: ReactNode;
  /**
   * Gateway WebSocket URL to connect to. Defaults to `defaultWsUrl()`, which
   * derives ws(s)://<current origin> — correct when the page is served by
   * the gateway itself (web-console). Clients loaded from a different origin
   * (e.g. app-desktop's file:// renderer) must pass this explicitly.
   */
  wsUrl?: string;
}) {
  const clientRef = useRef<GatewayClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  const disconnect = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    setConnected(false);
    setAuthenticated(false);
  }, []);

  // health + auth on a freshly-opened socket. Runs on the first connect()
  // and again on every automatic reconnect (gateway-client.ts) — the
  // gateway's auth state is per-socket, so a reconnected socket starts out
  // unauthenticated again even though the React tree above never noticed.
  const handshake = useCallback(async (c: GatewayClient, apiKey?: string) => {
    const healthRes = await c.call<Health>("health", {});
    setHealth(healthRes.result);

    if (healthRes.result.authRequired) {
      const key = apiKey ?? sessionStorage.getItem(API_KEY_STORAGE) ?? "";
      if (!key) {
        setAuthenticated(false);
        return;
      }
      await c.auth(key);
      sessionStorage.setItem(API_KEY_STORAGE, key);
    }
    setAuthenticated(true);
  }, []);

  const connect = useCallback(
    async (apiKey?: string) => {
      clientRef.current?.close();
      setConnected(false);
      setAuthenticated(false);

      const c = new GatewayClient(wsUrl ?? defaultWsUrl());
      // Assigned before the socket opens so a second connect() racing this
      // one (React StrictMode's dev-only double effect run) closes it
      // instead of leaving two live sockets behind.
      clientRef.current = c;
      const superseded = () => clientRef.current !== c;

      c.onStatus((status) => {
        if (superseded()) return;
        if (status === "closed") {
          setConnected(false);
          setAuthenticated(false);
          return;
        }
        setConnected(true);
        // A reconnect handshake failing (gateway mid-restart, key revoked)
        // just leaves `authenticated` false; the next reconnect retries it.
        handshake(c, apiKey).catch(() => undefined);
      });

      try {
        await c.connect();
      } catch (err) {
        if (superseded()) return;
        throw err;
      }
      if (superseded()) return;
      setConnected(true);
      await handshake(c, apiKey);
    },
    [wsUrl, handshake],
  );

  const call = useCallback(
    async <T,>(method: string, params: Record<string, unknown> = {}, options?: { timeoutMs?: number }) => {
      const c = clientRef.current;
      if (!c) throw new Error("Not connected");
      const { result } = await c.call<T>(method, params, options);
      return result;
    },
    [],
  );

  const callWithEvents = useCallback(
    async <T,>(method: string, params: Record<string, unknown> = {}) => {
      const c = clientRef.current;
      if (!c) throw new Error("Not connected");
      return c.call<T>(method, params, { collectEvents: true, timeoutMs: 60_000 });
    },
    [],
  );

  const onEvent = useCallback((handler: (ev: GatewayWsEvent) => void) => {
    const c = clientRef.current;
    if (!c) return () => {};
    return c.onEvent(handler);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({
      connected,
      authenticated,
      health,
      connect,
      call,
      callWithEvents,
      onEvent,
      disconnect,
    }),
    [connected, authenticated, health, connect, call, callWithEvents, onEvent, disconnect],
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGateway(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error("useGateway outside provider");
  return ctx;
}
