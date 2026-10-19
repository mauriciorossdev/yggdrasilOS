import { NavLink, Outlet } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";

export function Layout() {
  const { health, disconnect } = useGateway();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🌳</span>
          <div>
            <strong>Yggdrasil</strong>
            <small>v{health?.version ?? "—"}</small>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/chat">Chat</NavLink>
          <NavLink to="/sessions">Sessions</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <button type="button" className="link-btn" onClick={disconnect}>
          Desconectar
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
