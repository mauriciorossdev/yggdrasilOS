import { describe, it, expect } from "vitest";
import { branchRemoteTarget, branchUrl, compareUrl, parseRemoteUrl, remoteWeb } from "./branchUrl.js";

describe("parseRemoteUrl", () => {
  it.each([
    ["https://github.com/acme/widgets.git", "github.com", "acme/widgets"],
    ["https://user:tok@github.com/acme/widgets", "github.com", "acme/widgets"],
    ["git@github.com:acme/widgets.git", "github.com", "acme/widgets"],
    ["ssh://git@gitlab.example.com:2222/grp/sub/proj.git", "gitlab.example.com", "grp/sub/proj"],
    ["https://GitHub.com/acme/widgets/", "github.com", "acme/widgets"],
  ])("%s", (url, host, path) => {
    expect(parseRemoteUrl(url)).toEqual({ host, path });
  });

  it("rejects local paths and single-segment urls", () => {
    expect(parseRemoteUrl("/tmp/bare.git")).toBeNull();
    expect(parseRemoteUrl("https://github.com/only")).toBeNull();
  });
});

describe("remoteWeb / urls", () => {
  it("github", () => {
    const w = remoteWeb("git@github.com:acme/widgets.git")!;
    expect(branchUrl(w, "feat/x y")).toBe("https://github.com/acme/widgets/tree/feat/x%20y");
    expect(compareUrl(w, "feat/x")).toBe("https://github.com/acme/widgets/compare/feat/x?expand=1");
  });

  it("gitlab (subgroups) and bitbucket", () => {
    const g = remoteWeb("https://gitlab.com/grp/sub/proj.git")!;
    expect(branchUrl(g, "main")).toBe("https://gitlab.com/grp/sub/proj/-/tree/main");
    expect(compareUrl(g, "feat/x")).toBe("https://gitlab.com/grp/sub/proj/-/merge_requests/new?merge_request[source_branch]=feat%2Fx");
    const b = remoteWeb("git@bitbucket.org:acme/w.git")!;
    expect(branchUrl(b, "main")).toBe("https://bitbucket.org/acme/w/src/main");
    expect(compareUrl(b, "feat/x")).toBe("https://bitbucket.org/acme/w/pull-requests/new?source=feat%2Fx");
  });

  it("unknown host → null", () => {
    expect(remoteWeb("https://dev.azure.com/org/proj/_git/repo")).toBeNull();
  });
});

describe("branchRemoteTarget", () => {
  const remotes = [
    { name: "origin", url: "u1" },
    { name: "up", url: "u2" },
  ];
  it("remote branch, local with upstream, local without", () => {
    expect(branchRemoteTarget({ name: "origin/feat/x", remote: true }, remotes)).toEqual({ remote: remotes[0], branch: "feat/x" });
    expect(branchRemoteTarget({ name: "x", remote: false, upstream: "up/x2" }, remotes)).toEqual({ remote: remotes[1], branch: "x2" });
    expect(branchRemoteTarget({ name: "x", remote: false }, remotes)).toBeNull();
    expect(branchRemoteTarget({ name: "origin/x", remote: true }, [])).toBeNull();
  });
});
