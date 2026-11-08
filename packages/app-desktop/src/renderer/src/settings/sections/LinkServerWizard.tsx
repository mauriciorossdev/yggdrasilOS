import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal } from "../../ui/index.js";
import { useI18n } from "../../i18n/index.js";
import type { HubTestResult, HubUrlCheck, PhoneLinkInfo } from "../../types.js";
import { buildSetup, isValidDomain, isValidKey, maskKey, needsDomain, suggestedUrl, type DeployTarget } from "../linkServerSetup.js";
import { hubTestMessage } from "./phoneLinkMessages.js";

/** Kept by the section, so closing the dialog by accident doesn't lose a key already on the server. */
export type WizardDraft = { key: string; target: DeployTarget; domain: string; url: string | null };

export const EMPTY_WIZARD_DRAFT: WizardDraft = { key: "", target: "vps", domain: "", url: null };

const TARGETS: DeployTarget[] = ["vps", "cloud", "cloudflare", "local"];

function CopyBlock({ label, code, secret }: { label: string; code: string; secret: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [code]);
  return (
    <div className="link-wizard-block">
      <div className="link-wizard-block-head">
        <span>{label}</span>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? t("set.phone.copied") : t("set.phone.wiz.copy")}
        </Button>
      </div>
      <pre className="link-wizard-code">{maskKey(code, secret)}</pre>
    </div>
  );
}

/**
 * Settings → Phone: walks through creating a link server. No provider integrations:
 * it writes the commands, the user runs them, and the connection test closes the loop.
 */
export function LinkServerWizard({
  info,
  draft,
  onDraft,
  onClose,
  onFinished,
}: {
  info: PhoneLinkInfo;
  draft: WizardDraft;
  onDraft: (next: WizardDraft) => void;
  onClose: () => void;
  onFinished: (next: PhoneLinkInfo) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [urlCheck, setUrlCheck] = useState<HubUrlCheck>("empty");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<HubTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<PhoneLinkInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const { key, target, domain } = draft;
  const set = (patch: Partial<WizardDraft>) => onDraft({ ...draft, ...patch });
  const url = draft.url ?? suggestedUrl(target, { domain, lan: info.addresses.lan });
  const blocks = buildSetup(target, { key, domain });
  const keyOk = isValidKey(key);
  const urlBlocked = urlCheck === "invalid" || urlCheck === "insecure-public";

  useEffect(() => {
    let current = true;
    void window.yggdrasil.phoneLink.checkUrl(url).then((check) => {
      if (current) setUrlCheck(check);
    });
    return () => {
      current = false;
    };
  }, [url]);

  // A result only describes the URL and key it ran with.
  const testToken = useRef(0);
  useEffect(() => {
    testToken.current += 1;
    setTest(null);
    setTesting(false);
  }, [url, key]);

  const runTest = async () => {
    const token = ++testToken.current;
    setTesting(true);
    setTest(null);
    try {
      const result = await window.yggdrasil.phoneLink.test({ hubUrl: url, hubKey: key });
      if (token === testToken.current) setTest(result);
    } catch (e) {
      if (token === testToken.current) setTest({ ok: false, code: "unreachable", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      if (token === testToken.current) setTesting(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.yggdrasil.phoneLink.save({ hubUrl: url, hubKey: key, publish: true });
      setPublished(next);
      onFinished(next);
      setQr(await window.yggdrasil.phoneLink.qr());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = published ? (
    <Button variant="primary" onClick={onClose}>
      {t("set.phone.wiz.done")}
    </Button>
  ) : (
    <>
      {step > 1 && <Button onClick={() => setStep(step - 1)}>{t("set.phone.wiz.back")}</Button>}
      {step === 1 && (
        <Button variant="primary" disabled={!keyOk} onClick={() => setStep(2)}>
          {t("set.phone.wiz.next")}
        </Button>
      )}
      {step === 2 && (
        <Button variant="primary" disabled={!blocks} onClick={() => setStep(3)}>
          {t("set.phone.wiz.deployed")}
        </Button>
      )}
      {step === 3 && (
        <Button variant="primary" disabled={busy || !test?.ok} onClick={() => void publish()}>
          {t("set.phone.wiz.savePublish")}
        </Button>
      )}
    </>
  );

  return (
    <Modal title={t("set.phone.wiz.title")} onClose={onClose} footer={footer}>
      <div className="link-wizard">
        <p className="muted link-wizard-step">{t("set.phone.wiz.step", { n: published ? 3 : step })}</p>

        {published ? (
          <>
            <p>{t("set.phone.wiz.publishedIntro")}</p>
            {published.needsReopen.length > 0 && <p className="error">{t("set.phone.needsReopen", { names: published.needsReopen.join(", ") })}</p>}
            {qr && (
              <>
                <img src={qr} alt={t("set.phone.qrAlt")} width={220} height={220} />
                <p className="muted">{t("set.phone.qrHint")}</p>
              </>
            )}
          </>
        ) : step === 1 ? (
          <>
            <p>{t("set.phone.wiz.keyIntro")}</p>
            {info.hasHubKey && <p className="muted">{t("set.phone.wiz.keyReplaces")}</p>}
            <Field label={t("set.phone.hubKey")}>
              <Input
                type="password"
                value={key}
                autoComplete="off"
                placeholder={t("set.phone.keyPaste")}
                onChange={(e) => set({ key: e.target.value.trim() })}
              />
            </Field>
            {key && !keyOk && <p className="error">{t("set.phone.wiz.keyInvalid")}</p>}
            <div>
              <Button onClick={() => void window.yggdrasil.phoneLink.generateKey().then((next) => set({ key: next }))}>
                {t("set.phone.generateKey")}
              </Button>
            </div>
          </>
        ) : step === 2 ? (
          <>
            <fieldset className="link-wizard-targets">
              <legend>{t("set.phone.wiz.whereTitle")}</legend>
              {TARGETS.map((option) => (
                <label key={option} className="settings-check">
                  <input type="radio" name="link-target" checked={target === option} onChange={() => set({ target: option, url: null })} />
                  <span>
                    <strong>{t(`set.phone.wiz.target.${option}`)}</strong>
                    <span className="muted"> · {t(`set.phone.wiz.target.${option}Hint`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {target === "cloudflare" && <p className="error">{t("set.phone.wiz.untested")}</p>}
            {needsDomain(target) && (
              <>
                <Field label={t("set.phone.wiz.domain")}>
                  <Input value={domain} placeholder={t("set.phone.wiz.domainPlaceholder")} onChange={(e) => set({ domain: e.target.value.trim(), url: null })} />
                </Field>
                {domain && !isValidDomain(domain) && <p className="error">{t("set.phone.wiz.domainInvalid")}</p>}
              </>
            )}

            <p className="muted">{t(`set.phone.wiz.steps.${target}`)}</p>
            {blocks?.map((block) => <CopyBlock key={block.labelKey} label={t(block.labelKey)} code={block.code} secret={key} />)}
            {blocks && target !== "cloud" && <p className="muted">{t("set.phone.wiz.historyWarning")}</p>}
            <p className="muted">{t("set.phone.wiz.guide")}</p>
          </>
        ) : (
          <>
            <p>{t("set.phone.wiz.connectIntro")}</p>
            <Field label={t("set.phone.hubUrl")}>
              <Input value={url} placeholder={t("set.phone.hubUrlPlaceholder")} onChange={(e) => set({ url: e.target.value })} />
            </Field>
            {urlCheck === "insecure-public" && <p className="error">{t("set.phone.urlInsecurePublic")}</p>}
            {urlCheck === "invalid" && <p className="error">{t("set.phone.urlInvalid")}</p>}
            {urlCheck === "insecure-local" && <p className="muted">{t("set.phone.urlInsecureLocal")}</p>}
            <div>
              <Button disabled={testing || urlBlocked || urlCheck === "empty"} onClick={() => void runTest()}>
                {testing ? t("set.phone.testing") : t("set.phone.test")}
              </Button>
            </div>
            {test && <p className={test.ok ? "muted" : "error"} role="status">{hubTestMessage(t, test)}</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
