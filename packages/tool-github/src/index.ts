import { definePlugin } from "@yggdrasil/sdk";
import { githubCloneRepoTool, githubListReposTool } from "./tools.js";
import { deleteGithubAccount, getGithubAccount, requireAccessToken, saveGithubAccount } from "./account.js";
import { getGithubClientId, pollForToken, requestDeviceCode } from "./oauth.js";
import { getAuthenticatedLogin, listRepos } from "./github-api.js";
import { cloneRepo } from "./clone.js";

export { githubCloneRepoTool, githubListReposTool } from "./tools.js";
export { getGithubAccount } from "./account.js";

const plugin = definePlugin({
  id: "tool-github",
  name: "GitHub Connector",
  version: "0.1.0",
  register(api) {
    for (const tool of [githubListReposTool, githubCloneRepoTool]) {
      api.registerTool(tool);
      api.logger.info("registered github connector tool", { name: tool.name });
    }

    // Device Flow: start hands back the code the user types at
    // verification_uri; the UI then polls `poll` until it resolves. The
    // access token never leaves this process — only status/login do.
    api.registerGatewayMethod("connectors.github.start", async () => {
      const d = await requestDeviceCode(getGithubClientId());
      return {
        deviceCode: d.device_code,
        userCode: d.user_code,
        verificationUri: d.verification_uri,
        expiresIn: d.expires_in,
        interval: d.interval,
      };
    });

    api.registerGatewayMethod("connectors.github.poll", async (params) => {
      const deviceCode = String(params.deviceCode ?? "").trim();
      if (!deviceCode) throw new Error("connectors.github.poll: deviceCode is required");
      const result = await pollForToken(getGithubClientId(), deviceCode);
      if (result.status === "authorized") {
        const login = await getAuthenticatedLogin(result.accessToken);
        await saveGithubAccount({
          accessToken: result.accessToken,
          scopes: result.scopes,
          login,
          connectedAt: Date.now(),
        });
        return { status: "authorized", login };
      }
      return result;
    });

    api.registerGatewayMethod("connectors.github.status", async () => {
      const account = await getGithubAccount();
      if (!account) return { connected: false };
      return { connected: true, login: account.login, scopes: account.scopes, connectedAt: account.connectedAt };
    });

    api.registerGatewayMethod("connectors.github.disconnect", async () => {
      await deleteGithubAccount();
      return { ok: true };
    });

    api.registerGatewayMethod("connectors.github.listRepos", async (params) => {
      return listRepos(await requireAccessToken(), {
        page: params.page !== undefined ? Number(params.page) : undefined,
        perPage: params.perPage !== undefined ? Number(params.perPage) : undefined,
      });
    });

    // User-clicked action (parentDir comes from a native folder picker), so a
    // direct gateway method rather than the agent-tool approval path.
    api.registerGatewayMethod("connectors.github.clone", async (params) => {
      const repo = String(params.repo ?? "").trim();
      const parentDir = String(params.parentDir ?? "").trim();
      if (!repo) throw new Error("connectors.github.clone: repo is required");
      if (!parentDir) throw new Error("connectors.github.clone: parentDir is required");
      return cloneRepo(await requireAccessToken(), {
        repo,
        parentDir,
        folderName: params.folderName !== undefined ? String(params.folderName) : undefined,
      });
    });
  },
});

export default plugin;
