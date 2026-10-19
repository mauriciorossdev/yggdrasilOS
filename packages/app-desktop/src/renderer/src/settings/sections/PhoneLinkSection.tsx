import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { PhoneLinkInfo } from "../../types.js";

type TrustedDevice = { deviceId: string; trustedAt: string };

function ago(ms?: number): string {
  if (!ms) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.round(s / 60)} min`;
}

/**
 * Settings → Teléfono: publish this desktop to the Railway gateway so the phone
 * finds it on its own (notes/asistente-personal/enlace-escritorio.md), and
 * show the one-time QR the phone scans to learn the Railway URL + key.
 */
export function PhoneLinkSection() {
  const { call } = useGateway();
  const [info, setInfo] = useState<PhoneLinkInfo | null>(null);
  const [hubUrl, setHubUrl] = useState("");
  const [hubKey, setHubKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);

  // Per-project, not per-desktop (unlike the publish settings above) — this
  // reads whichever project's gateway the Settings view is currently open
  // against, same as DocumentsView/WorkflowsView's own useGateway() calls.
  const loadTrustedDevices = useCallback(() => {
    void call<{ devices: TrustedDevice[] }>("devices.trust.list", {})
      .then((res) => setTrustedDevices(res.devices))
      .catch(() => {});
  }, [call]);

  useEffect(() => loadTrustedDevices(), [loadTrustedDevices]);

  const revokeTrust = (deviceId: string) => {
    void call("devices.trust.set", { deviceId, trusted: false }).then(loadTrustedDevices);
  };

  const apply = (next: PhoneLinkInfo) => {
    setInfo(next);
    setHubUrl(next.hubUrl);
  };

  useEffect(() => {
    void window.yggdrasil.phoneLink.get().then(apply).catch((e) => setError(String(e)));
    const timer = setInterval(() => void window.yggdrasil.phoneLink.get().then(setInfo).catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (fn: () => Promise<PhoneLinkInfo>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
      setHubKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showQr = async () => {
    setError(null);
    try {
      setQr(await window.yggdrasil.phoneLink.qr());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!info) return <p className="muted">Cargando…</p>;
  const st = info.status;

  return (
    <section className="settings-section">
      <h3>Teléfono</h3>
      <p className="muted">
        Publica este equipo en tu gateway de Railway para que la app del teléfono lo encuentre sola, sin escribir IP, puerto ni
        clave. Mientras esté publicado, los gateways de este equipo exigen una clave a cualquier conexión que no sea de este
        mismo computador.
      </p>

      <label>
        URL de Railway
        <input type="text" value={hubUrl} placeholder="https://tu-gateway.up.railway.app" onChange={(e) => setHubUrl(e.target.value)} />
      </label>
      <label>
        Clave de Railway (YGGDRASIL_API_KEY)
        <input
          type="password"
          value={hubKey}
          placeholder={info.hasHubKey ? "•••••••• (guardada; escribe otra para cambiarla)" : "Pega la clave"}
          onChange={(e) => setHubKey(e.target.value)}
        />
      </label>
      <div className="ide-option-row">
        <button disabled={busy} onClick={() => void run(() => window.yggdrasil.phoneLink.save({ hubUrl, hubKey }))}>
          Guardar
        </button>
        <label>
          <input
            type="checkbox"
            checked={info.publish}
            disabled={busy}
            onChange={(e) => void run(() => window.yggdrasil.phoneLink.save({ hubUrl, hubKey, publish: e.target.checked }))}
          />
          Publicar este equipo en Railway
        </label>
      </div>

      <p className="muted">
        Equipo: <strong>{info.desktopName}</strong> · red local: {info.addresses.lan ?? "—"} · Tailscale:{" "}
        {info.addresses.tailscale ?? "no detectado"}
      </p>
      <p className={st.state === "error" ? "error" : "muted"}>
        {st.state === "disabled" && "Sin publicar."}
        {st.state === "idle" && "Preparando…"}
        {st.state === "ok" && `Publicado · último aviso ${ago(st.lastOkAt)}`}
        {st.state === "error" && `No se pudo publicar: ${st.lastError} (último aviso correcto: ${ago(st.lastOkAt)})`}
      </p>
      <p className={info.tunnel.state === "error" ? "error" : "muted"}>
        Túnel (acceso desde cualquier red):{" "}
        {info.tunnel.state === "disabled" && "apagado"}
        {info.tunnel.state === "connecting" && "conectando…"}
        {info.tunnel.state === "connected" && "conectado"}
        {info.tunnel.state === "error" && `sin conexión${info.tunnel.lastError ? ` (${info.tunnel.lastError})` : ""}, reintentando`}
      </p>
      {info.needsReopen.length > 0 && (
        <p className="error">
          El teléfono no ve {info.needsReopen.join(", ")}: se abrieron antes de activar la publicación y no tienen clave.
          Ciérralos y vuelve a abrirlos (o reinicia la app).
        </p>
      )}
      <div className="ide-option-row">
        <button disabled={busy || !info.publish} onClick={() => void run(() => window.yggdrasil.phoneLink.publishNow())}>
          Publicar ahora
        </button>
        <button disabled={!info.hasHubKey || !info.hubUrl} onClick={() => (qr ? setQr(null) : void showQr())}>
          {qr ? "Ocultar QR" : "Mostrar QR para el teléfono"}
        </button>
      </div>
      {qr && (
        <div style={{ marginTop: 12 }}>
          <img src={qr} alt="QR con la URL y la clave de Railway" width={240} height={240} />
          <p className="muted">
            Escanéalo una vez con la app (Perfiles → Escanear). Contiene la clave de Railway: no lo compartas ni lo dejes a la
            vista.
          </p>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <h3 style={{ marginTop: 20 }}>Dispositivos confiables</h3>
      <p className="muted">
        Un dispositivo marcado como confiable (desde el banner de "Confiar en este dispositivo" al abrir una aprobación) deja
        de pedir aprobación para leer/escribir archivos de este proyecto. Solo aplica a este proyecto, no a los demás.
      </p>
      {trustedDevices.length === 0 ? (
        <p className="muted">Ningún dispositivo confiable para este proyecto todavía.</p>
      ) : (
        <ul className="trusted-devices-list">
          {trustedDevices.map((d) => (
            <li key={d.deviceId}>
              <span className="trusted-device-id">{d.deviceId}</span>
              <span className="muted">confiado {ago(new Date(d.trustedAt).getTime())}</span>
              <button onClick={() => revokeTrust(d.deviceId)}>Quitar confianza</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
