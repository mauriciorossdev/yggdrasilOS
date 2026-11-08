import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../../i18n/index.js";
import type { HubTestResult, HubUrlCheck, PhoneLinkInfo } from "../../types.js";
import { EMPTY_WIZARD_DRAFT, LinkServerWizard, type WizardDraft } from "./LinkServerWizard.js";
import { hubTestMessage } from "./phoneLinkMessages.js";

type TrustedDevice = { deviceId: string; trustedAt: string };

function ago(t: ReturnType<typeof useI18n>["t"], ms?: number): string {
  if (!ms) return t("set.phone.agoNever");
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t("set.phone.agoSec", { s });
  return t("set.phone.agoMin", { m: Math.round(s / 60) });
}

/**
 * Settings → Teléfono: publish this desktop to the link server so the phone
 * finds it on its own (notes/asistente-personal/enlace-escritorio.md), and
 * show the one-time QR the phone scans to learn the server's URL + key.
 */
export function PhoneLinkSection() {
  const { t } = useI18n();
  const { call } = useGateway();
  const [info, setInfo] = useState<PhoneLinkInfo | null>(null);
  const [hubUrl, setHubUrl] = useState("");
  const [hubKey, setHubKey] = useState("");
  // A just-generated key has to be readable: the user copies it to the server.
  const [keyGenerated, setKeyGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [urlCheck, setUrlCheck] = useState<HubUrlCheck>("empty");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<HubTestResult | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDraft, setWizardDraft] = useState<WizardDraft>(EMPTY_WIZARD_DRAFT);
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

  // Asked to main, the one place that decides what a URL may receive.
  useEffect(() => {
    let current = true;
    void window.yggdrasil.phoneLink.checkUrl(hubUrl).then((check) => {
      if (current) setUrlCheck(check);
    });
    return () => {
      current = false;
    };
  }, [hubUrl]);

  // A result only describes the URL and key it was run with.
  const testToken = useRef(0);
  useEffect(() => {
    testToken.current += 1;
    setTesting(false);
    setTestResult(null);
  }, [hubUrl, hubKey]);

  const testConnection = async () => {
    const token = ++testToken.current;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.yggdrasil.phoneLink.test({ hubUrl, hubKey });
      if (token === testToken.current) setTestResult(result);
    } catch (e) {
      if (token === testToken.current) setTestResult({ ok: false, code: "unreachable", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      if (token === testToken.current) setTesting(false);
    }
  };

  const generateKey = async () => {
    setError(null);
    setCopied(false);
    setHubKey(await window.yggdrasil.phoneLink.generateKey());
    setKeyGenerated(true);
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(hubKey);
    setCopied(true);
  };

  const run = async (fn: () => Promise<PhoneLinkInfo>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
      setHubKey("");
      setKeyGenerated(false);
      setCopied(false);
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

  if (!info) return <p className="muted">{t("set.phone.loading")}</p>;
  const st = info.status;
  const urlBlocked = urlCheck === "invalid" || urlCheck === "insecure-public";
  // Same rule as main's savedKeyWouldMove, which is what actually enforces it.
  const keyNeeded = info.hasHubKey && !!hubUrl.trim() && hubUrl.trim() !== info.hubUrl && !hubKey.trim();

  return (
    <section className="settings-section">
      <h3>{t("set.phone.title")}</h3>
      <p className="muted">
        {t("set.phone.intro")}
      </p>

      <div className="ide-option-row">
        <button type="button" onClick={() => setWizardOpen(true)}>
          {t("set.phone.wiz.open")}
        </button>
        <span className="muted">{t("set.phone.wiz.openHint")}</span>
      </div>
      {wizardOpen && (
        <LinkServerWizard
          info={info}
          draft={wizardDraft}
          onDraft={setWizardDraft}
          onClose={() => setWizardOpen(false)}
          onFinished={(next) => {
            apply(next);
            setWizardDraft(EMPTY_WIZARD_DRAFT);
          }}
        />
      )}

      <label>
        {t("set.phone.hubUrl")}
        <input type="text" value={hubUrl} placeholder={t("set.phone.hubUrlPlaceholder")} onChange={(e) => setHubUrl(e.target.value)} />
      </label>
      {urlCheck === "insecure-public" && <p className="error">{t("set.phone.urlInsecurePublic")}</p>}
      {urlCheck === "invalid" && <p className="error">{t("set.phone.urlInvalid")}</p>}
      {urlCheck === "insecure-local" && <p className="muted">{t("set.phone.urlInsecureLocal")}</p>}
      <label>
        {t("set.phone.hubKey")}
        <input
          type={keyGenerated ? "text" : "password"}
          value={hubKey}
          placeholder={info.hasHubKey ? t("set.phone.keySaved") : t("set.phone.keyPaste")}
          onChange={(e) => setHubKey(e.target.value)}
        />
      </label>
      <div className="ide-option-row">
        <button type="button" disabled={busy} onClick={() => void generateKey()}>
          {t("set.phone.generateKey")}
        </button>
        {keyGenerated && (
          <button type="button" onClick={() => void copyKey()}>
            {copied ? t("set.phone.copied") : t("set.phone.copyKey")}
          </button>
        )}
      </div>
      {keyGenerated && <p className="muted">{t("set.phone.generatedHint")}</p>}
      {keyNeeded && !urlBlocked && <p className="muted">{t("set.phone.keyNeededForUrl")}</p>}
      <div className="ide-option-row">
        <button disabled={busy || urlBlocked || keyNeeded} onClick={() => void run(() => window.yggdrasil.phoneLink.save({ hubUrl, hubKey }))}>
          {t("set.phone.save")}
        </button>
        <button type="button" disabled={testing || urlBlocked || urlCheck === "empty"} onClick={() => void testConnection()}>
          {testing ? t("set.phone.testing") : t("set.phone.test")}
        </button>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={info.publish}
            disabled={busy || urlBlocked || keyNeeded}
            onChange={(e) => void run(() => window.yggdrasil.phoneLink.save({ hubUrl, hubKey, publish: e.target.checked }))}
          />
          {t("set.phone.publish")}
        </label>
      </div>
      {testResult && <p className={testResult.ok ? "muted" : "error"} role="status">{hubTestMessage(t, testResult)}</p>}

      <p className="muted">
        {t("set.phone.machine")} <strong>{info.desktopName}</strong> · {t("set.phone.lan")} {info.addresses.lan ?? "—"} · Tailscale:{" "}
        {info.addresses.tailscale ?? t("set.phone.notDetected")}
      </p>
      <p className={st.state === "error" ? "error" : "muted"}>
        {st.state === "disabled" && t("set.phone.stDisabled")}
        {st.state === "idle" && t("set.phone.stIdle")}
        {st.state === "ok" && t("set.phone.stOk", { ago: ago(t, st.lastOkAt) })}
        {st.state === "error" && t("set.phone.stError", { error: st.lastError ?? "", ago: ago(t, st.lastOkAt) })}
      </p>
      <p className={info.tunnel.state === "error" ? "error" : "muted"}>
        {t("set.phone.tunnel")}{" "}
        {info.tunnel.state === "disabled" && t("set.phone.tunOff")}
        {info.tunnel.state === "connecting" && t("set.phone.tunConnecting")}
        {info.tunnel.state === "connected" && t("set.phone.tunConnected")}
        {info.tunnel.state === "error" && t("set.phone.tunError", { detail: info.tunnel.lastError ? ` (${info.tunnel.lastError})` : "" })}
      </p>
      {info.needsReopen.length > 0 && (
        <p className="error">
          {t("set.phone.needsReopen", { names: info.needsReopen.join(", ") })}
        </p>
      )}
      <div className="ide-option-row">
        <button disabled={busy || !info.publish} onClick={() => void run(() => window.yggdrasil.phoneLink.publishNow())}>
          {t("set.phone.publishNow")}
        </button>
        <button disabled={!info.hasHubKey || !info.hubUrl || info.hubUrlCheck === "insecure-public"} onClick={() => (qr ? setQr(null) : void showQr())}>
          {qr ? t("set.phone.hideQr") : t("set.phone.showQr")}
        </button>
      </div>
      {qr && (
        <div style={{ marginTop: 12 }}>
          <img src={qr} alt={t("set.phone.qrAlt")} width={240} height={240} />
          <p className="muted">
            {t("set.phone.qrHint")}
          </p>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <h3 style={{ marginTop: 20 }}>{t("set.phone.trustedTitle")}</h3>
      <p className="muted">
        {t("set.phone.trustedIntro")}
      </p>
      {trustedDevices.length === 0 ? (
        <p className="muted">{t("set.phone.trustedNone")}</p>
      ) : (
        <ul className="trusted-devices-list">
          {trustedDevices.map((d) => (
            <li key={d.deviceId}>
              <span className="trusted-device-id">{d.deviceId}</span>
              <span className="muted">{t("set.phone.trustedAgo", { ago: ago(t, new Date(d.trustedAt).getTime()) })}</span>
              <button onClick={() => revokeTrust(d.deviceId)}>{t("set.phone.untrust")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
