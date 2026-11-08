/**
 * The commands the "Create my link server" wizard hands out. The single source
 * for them: linkServerSetup.test.ts checks them against the real files in deploy/.
 * No provider integrations, by design (notes/servidor-de-enlace.md).
 */

export type DeployTarget = "vps" | "cloud" | "cloudflare" | "local";

export type SetupBlock = {
  /** i18n key of the line above the block. */
  labelKey: "set.phone.wiz.blockServer" | "set.phone.wiz.blockEnv" | "set.phone.wiz.blockRun" | "set.phone.wiz.blockVariable";
  code: string;
};

export const REPO_URL = "https://github.com/mauriciorossdev/yggdrasilOS.git";
export const KEY_PLACEHOLDER = "••••••••";
export const TUNNEL_TOKEN_PLACEHOLDER = "paste-your-tunnel-token";
const IMAGE = "yggdrasil-gateway";

/**
 * Letters, digits and URL-safe punctuation only. A key goes into a .env file that
 * `docker run --env-file` reads literally and compose interpolates, so spaces,
 * quotes or `$` would silently change it on the server.
 */
export function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9._~+/=-]{16,512}$/.test(key);
}

/** A public hostname with no scheme or path: it ends up in a shell block and a certificate. */
export function isValidDomain(domain: string): boolean {
  return domain.length <= 253 && /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

export function needsDomain(target: DeployTarget): boolean {
  return target === "vps" || target === "cloudflare";
}

/** What the connect step starts with; the user can still edit it. */
export function suggestedUrl(target: DeployTarget, values: { domain: string; lan?: string }): string {
  if (needsDomain(target)) return isValidDomain(values.domain) ? `https://${values.domain}` : "";
  return target === "local" && values.lan ? `http://${values.lan}:8787` : "";
}

function cloneLines(): string[] {
  return [`git clone ${REPO_URL} yggdrasil`, "cd yggdrasil"];
}

/** Null until the values it needs are valid, so a half-filled block can't be copied. */
export function buildSetup(target: DeployTarget, values: { key: string; domain: string }): SetupBlock[] | null {
  const { key, domain } = values;
  if (!isValidKey(key) || (needsDomain(target) && !isValidDomain(domain))) return null;
  const keyLine = `YGGDRASIL_API_KEY=${key}`;
  switch (target) {
    case "vps":
      return [
        {
          labelKey: "set.phone.wiz.blockServer",
          code: [
            ...cloneLines(),
            "cat > deploy/.env <<'EOF'",
            keyLine,
            `DOMAIN=${domain}`,
            "EOF",
            "chmod 600 deploy/.env",
            "docker compose -f deploy/docker-compose.yml up -d --build",
          ].join("\n"),
        },
      ];
    case "cloud":
      return [{ labelKey: "set.phone.wiz.blockVariable", code: keyLine }];
    case "cloudflare":
      return [
        { labelKey: "set.phone.wiz.blockEnv", code: [keyLine, `TUNNEL_TOKEN=${TUNNEL_TOKEN_PLACEHOLDER}`].join("\n") },
        {
          labelKey: "set.phone.wiz.blockRun",
          code: [...cloneLines(), "docker compose -f deploy/docker-compose.cloudflare.yml up -d --build"].join("\n"),
        },
      ];
    case "local":
      return [
        { labelKey: "set.phone.wiz.blockEnv", code: keyLine },
        {
          labelKey: "set.phone.wiz.blockRun",
          code: [
            ...cloneLines(),
            `docker build -t ${IMAGE} .`,
            `docker run -d --name ${IMAGE} --restart unless-stopped --env-file deploy/.env -p 8787:8787 -v yggdrasil-data:/data ${IMAGE}`,
          ].join("\n"),
        },
      ];
  }
}

/** What's shown on screen: the key only travels through the copy button. */
export function maskKey(code: string, key: string): string {
  return key ? code.split(key).join(KEY_PLACEHOLDER) : code;
}
