import { defineTool } from "@yggdrasil/tools-sdk";
import { requireAccessToken } from "./account.js";
import { listRepos } from "./github-api.js";
import { cloneRepo } from "./clone.js";
import { getWorkspaceRootOrThrow } from "./workspace.js";

export const githubListReposTool = defineTool({
  name: "github_list_repos",
  description:
    "Lists the connected GitHub account's repositories (owned, collaborator and organization), most recently " +
    "pushed first. Read-only. Requires GitHub to be connected in Settings → Connectors.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      page: { type: "integer", description: "1-based page. Default 1." },
      perPage: { type: "integer", description: "Default 30, max 100." },
    },
  },
  async execute(_ctx, args) {
    const accessToken = await requireAccessToken();
    return listRepos(accessToken, {
      page: args.page !== undefined ? Number(args.page) : undefined,
      perPage: args.perPage !== undefined ? Number(args.perPage) : undefined,
    });
  },
});

export const githubCloneRepoTool = defineTool({
  name: "github_clone_repo",
  description:
    'Clones a GitHub repository ("owner/name") from the connected account into a new folder. Writes to disk. ' +
    "By default clones inside the current project folder; pass parentDir to clone elsewhere. Fails if the " +
    "target folder already exists.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: 'Repository as "owner/name".' },
      parentDir: { type: "string", description: "Absolute folder to clone into. Defaults to the project folder." },
      folderName: { type: "string", description: "Name of the new folder. Defaults to the repo name." },
    },
    required: ["repo"],
  },
  async execute(_ctx, args) {
    const repo = String(args.repo ?? "").trim();
    if (!repo) throw new Error("github_clone_repo: repo is required");
    const accessToken = await requireAccessToken();
    const parentDir =
      args.parentDir !== undefined ? String(args.parentDir) : getWorkspaceRootOrThrow("github_clone_repo");
    return cloneRepo(accessToken, {
      repo,
      parentDir,
      folderName: args.folderName !== undefined ? String(args.folderName) : undefined,
    });
  },
});
