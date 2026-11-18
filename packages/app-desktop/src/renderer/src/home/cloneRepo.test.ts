import { describe, expect, it } from "vitest";
import { filterRepos, gatewayErrorMessage, ipcErrorMessage, suggestFolderName, type GithubRepoItem } from "./cloneRepo.js";

describe("suggestFolderName", () => {
  it.each([
    ["https://github.com/acme/widgets.git", "widgets"],
    ["https://github.com/acme/widgets/", "widgets"],
    ["https://github.com/acme/widgets?tab=readme", "widgets"],
    ["git@github.com:acme/widgets.git", "widgets"],
    ["ssh://git@example.com:2222/team/app.git", "app"],
    ["gitlab.com/group/sub/project", "project"],
    ["acme/my.repo", "my.repo"],
    ["https://github.com", ""],
    ["", ""],
  ])("%j → %j", (url, folder) => {
    expect(suggestFolderName(url)).toBe(folder);
  });
});

describe("filterRepos", () => {
  const repo = (fullName: string, description: string | null = null): GithubRepoItem => ({
    fullName,
    name: fullName.split("/")[1]!,
    description,
    private: false,
    fork: false,
    cloneUrl: `https://github.com/${fullName}.git`,
    updatedAt: "",
  });
  const repos = [repo("acme/widgets", "Widget factory"), repo("acme/api"), repo("other/Gadgets")];

  it("keeps everything for a blank query", () => {
    expect(filterRepos(repos, "  ")).toHaveLength(3);
  });

  it("matches owner/name and description, case-insensitively", () => {
    expect(filterRepos(repos, "gadg").map((r) => r.fullName)).toEqual(["other/Gadgets"]);
    expect(filterRepos(repos, "FACTORY").map((r) => r.fullName)).toEqual(["acme/widgets"]);
    expect(filterRepos(repos, "acme/").map((r) => r.fullName)).toEqual(["acme/widgets", "acme/api"]);
  });
});

describe("ipcErrorMessage", () => {
  it("strips Electron's remote-method prefix", () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'projects:cloneRepo': Error: boom"))).toBe("boom");
    expect(ipcErrorMessage(new Error("plain"))).toBe("plain");
  });
});

describe("gatewayErrorMessage", () => {
  it("strips the error code and the connectors.github prefix", () => {
    expect(gatewayErrorMessage(new Error("INTERNAL_ERROR: Couldn't reach GitHub (UND_ERR_SOCKET)"))).toBe(
      "Couldn't reach GitHub (UND_ERR_SOCKET)",
    );
    expect(gatewayErrorMessage(new Error("INTERNAL_ERROR: connectors.github: not configured"))).toBe("not configured");
    expect(gatewayErrorMessage("plain")).toBe("plain");
  });
});
