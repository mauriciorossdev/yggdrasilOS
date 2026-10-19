import { definePlugin } from "@yggdrasil/sdk";
import {
  gcalListEventsTool,
  gcalCreateEventTool,
  gmailSearchTool,
  gmailReadTool,
  driveUploadDocumentTool,
} from "./tools.js";
import {
  buildAuthUrl,
  consumePendingState,
  createPendingState,
  exchangeCodeForTokens,
  getGoogleOAuthCredentials,
} from "./oauth.js";
import { getGoogleAccount, getWorkspaceRootOrThrow, saveGoogleAccount } from "./account.js";
import { getFreshAccessToken } from "./google-api.js";
import { uploadNoteToDrive } from "./drive.js";

export { gcalListEventsTool, gcalCreateEventTool, gmailSearchTool, gmailReadTool, driveUploadDocumentTool } from "./tools.js";
export { GOOGLE_OAUTH_SCOPES } from "./oauth.js";
export { getGoogleAccount } from "./account.js";

const tools = [gcalListEventsTool, gcalCreateEventTool, gmailSearchTool, gmailReadTool, driveUploadDocumentTool];

const plugin = definePlugin({
  id: "tool-google",
  name: "Google Calendar/Gmail Connector",
  version: "0.1.0",
  register(api) {
    for (const tool of tools) {
      api.registerTool(tool);
      api.logger.info("registered google connector tool", { name: tool.name });
    }

    // Phone-initiated consent (external-actions-and-connectors-analysis.md
    // §1.3-b): authUrl hands back a Google consent URL for the phone's own
    // browser to open; completeAuth receives the resulting code back over
    // the same WS connection once the phone's custom-scheme redirect
    // intercepts it. The refresh token this produces is written straight to
    // this gateway's yggdrasil.config.json (via saveGoogleAccount) and never
    // sent back to any client — same as every other secret in this project.
    api.registerGatewayMethod("connectors.google.authUrl", async () => {
      const credentials = getGoogleOAuthCredentials();
      const state = createPendingState();
      return { authUrl: buildAuthUrl(credentials, state), state };
    });

    api.registerGatewayMethod("connectors.google.completeAuth", async (params) => {
      const code = String(params.code ?? "").trim();
      const state = String(params.state ?? "").trim();
      if (!code) throw new Error("connectors.google.completeAuth: code is required");
      if (!state) throw new Error("connectors.google.completeAuth: state is required");
      if (!consumePendingState(state)) {
        throw new Error(
          "connectors.google.completeAuth: unknown or expired state — start over with connectors.google.authUrl",
        );
      }

      const credentials = getGoogleOAuthCredentials();
      const tokens = await exchangeCodeForTokens(credentials, code);
      const workspaceRoot = getWorkspaceRootOrThrow("connectors.google.completeAuth");
      await saveGoogleAccount(workspaceRoot, tokens);

      return { ok: true, connected: true, scopes: tokens.scope.split(" ").filter(Boolean) };
    });

    // Lets the mobile/desktop UI show connection state without needing to
    // attempt an actual API call first — never returns the refresh token
    // itself, same masking rule as everywhere else.
    api.registerGatewayMethod("connectors.google.status", async () => {
      const workspaceRoot = getWorkspaceRootOrThrow("connectors.google.status");
      const account = await getGoogleAccount(workspaceRoot);
      if (!account) return { connected: false };
      return { connected: true, scopes: account.scopes, connectedAt: account.connectedAt };
    });

    // Deterministic, user-clicked action (DocumentsView's "Share to Drive"
    // button) — a direct gateway method rather than routing through the
    // agent-tool/approval pipeline, since there's no model decision here to
    // gate. Shares the exact same core function as the drive_upload_document
    // agent tool above (see drive.ts's uploadNoteToDrive doc comment).
    api.registerGatewayMethod("documents.uploadToDrive", async (params) => {
      const path = String(params.path ?? "").trim();
      if (!path) throw new Error("documents.uploadToDrive: path is required");

      const workspaceRoot = getWorkspaceRootOrThrow("documents.uploadToDrive");
      const accessToken = await getFreshAccessToken(workspaceRoot);
      return uploadNoteToDrive(workspaceRoot, accessToken, path);
    });
  },
});

export default plugin;
