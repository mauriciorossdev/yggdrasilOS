import { useEffect, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

type GithubStatus = { connected: boolean; login?: string; connectedAt?: number };
type DeviceStart = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };
type PollResult = { status: "authorized"; login: string } | { status: "pending"; interval?: number } | { status: "error"; error: string };
type Repo = { fullName: string; name: string; description: string | null; private: boolean; fork: boolean; updatedAt: string };

// Own connect/poll cycle for the same reason ConnectorsSection's Google block
// has one — an immediate action, not part of SettingsView's batched Save.
export function GithubConnector() {
  const { call } = useGateway();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [cloning, setCloning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelled = useRef(false);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const loadStatus = async () => {
    try {
      setStatus(await call<GithubStatus>("connectors.github.status"));
    } catch (err) {
      fail(err);
    }
  };

  useEffect(() => {
    void loadStatus();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRepos = async (nextPage: number) => {
    setLoadingRepos(true);
    try {
      const res = await call<{ repos: Repo[]; hasMore: boolean }>("connectors.github.listRepos", { page: nextPage, perPage: 30 });
      setRepos((prev) => (nextPage === 1 ? res.repos : [...(prev ?? []), ...res.repos]));
      setPage(nextPage);
      setHasMore(res.hasMore);
    } catch (err) {
      fail(err);
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    if (status?.connected && repos === null) void loadRepos(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  const connect = async () => {
    setError(null);
    setNotice(null);
    cancelled.current = false;
    try {
      const d = await call<DeviceStart>("connectors.github.start");
      setDevice(d);
      window.open(d.verificationUri);
      let interval = Math.max(d.interval, 5) * 1000;
      const deadline = Date.now() + d.expiresIn * 1000;
      while (!cancelled.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval));
        if (cancelled.current) return;
        const res = await call<PollResult>("connectors.github.poll", { deviceCode: d.deviceCode });
        if (res.status === "authorized") {
          setDevice(null);
          setRepos(null);
          await loadStatus();
          return;
        }
        if (res.status === "error") throw new Error(res.error);
        if (res.interval) interval = res.interval * 1000;
      }
      throw new Error("The GitHub code expired — try connecting again.");
    } catch (err) {
      fail(err);
      setDevice(null);
    }
  };

  const disconnect = async () => {
    cancelled.current = true;
    try {
      await call("connectors.github.disconnect");
      setRepos(null);
      setDevice(null);
      await loadStatus();
    } catch (err) {
      fail(err);
    }
  };

  const clone = async (repo: Repo) => {
    setError(null);
    setNotice(null);
    const parentDir = await window.yggdrasil.dialog.openDirectory();
    if (!parentDir) return;
    setCloning(repo.fullName);
    try {
      const res = await call<{ path: string }>("connectors.github.clone", { repo: repo.fullName, parentDir });
      setNotice(`Cloned ${repo.fullName} to ${res.path}`);
    } catch (err) {
      fail(err);
    } finally {
      setCloning(null);
    }
  };

  return (
    <div className="settings-provider">
      <div className="mcp-server-header">
        <strong>GitHub</strong>
        {status?.connected ? (
          <button type="button" className="icon-btn" onClick={() => void disconnect()}>
            Disconnect
          </button>
        ) : (
          <button type="button" className="icon-btn" onClick={() => void connect()} disabled={device !== null}>
            {device ? "Waiting…" : "Connect"}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      {device && (
        <p className="muted">
          Enter code <strong>{device.userCode}</strong> at {device.verificationUri} (opened in your browser) to
          authorize Yggdrasil.
        </p>
      )}

      <p className="muted">
        {status === null && "Loading…"}
        {status && !status.connected && !device && "Not connected."}
        {status?.connected &&
          `Connected as ${status.login ?? "?"}${status.connectedAt ? ` since ${new Date(status.connectedAt).toLocaleDateString()}` : ""}`}
      </p>

      {status?.connected && repos && (
        <ul className="github-repos">
          {repos.map((repo) => (
            <li key={repo.fullName} className="mcp-server-header">
              <span>
                <strong>{repo.fullName}</strong>
                {repo.private ? " 🔒" : ""}
                {repo.description ? <span className="muted"> — {repo.description}</span> : null}
              </span>
              <button type="button" className="icon-btn" onClick={() => void clone(repo)} disabled={cloning !== null}>
                {cloning === repo.fullName ? "Cloning…" : "Clone"}
              </button>
            </li>
          ))}
          {repos.length === 0 && <li className="muted">No repositories found.</li>}
        </ul>
      )}
      {status?.connected && hasMore && (
        <button type="button" className="icon-btn" onClick={() => void loadRepos(page + 1)} disabled={loadingRepos}>
          {loadingRepos ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
