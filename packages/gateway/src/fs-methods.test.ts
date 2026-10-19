import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { YggdrasilConfig } from "@yggdrasil/config";
import { mergeConfig } from "@yggdrasil/config";
import { createDefaultGatewayContext, handleGatewayRequest, registerConnectionRemoteAddress } from "./methods.js";

// fs.* now requires approval before running (remote-access-analysis.md
// section 5, point 2) — same pendingApprovals/tool.approval.requested round
// trip an LLM tool call goes through. invokeGatewayMethod can't drive that:
// it builds its own context internally and blocks on the approval promise
// with no external hook to answer it, so every call would hang for the full
// 10-minute approval timeout. This helper keeps a reference to the context's
// event bus, answers the approval as soon as it's requested, and only then
// lets the fs.* call proceed — exactly how a real WS client (approving or
// denying) drives it.
let reqCounter = 0;

async function callFsMethod(
  method: string,
  params: Record<string, unknown>,
  config: YggdrasilConfig,
  workspaceRoot: string | undefined,
  approve = true,
  connectionId?: string,
): Promise<unknown> {
  const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
  const unsub = ctx.events.on<{ requestId: string }>("tool.approval.requested", (payload) => {
    void handleGatewayRequest(
      {
        id: `approve-${++reqCounter}`,
        method: "tools.approve",
        params: { requestId: payload.requestId, approved: approve },
      },
      ctx,
    );
  });

  try {
    const response = await handleGatewayRequest({ id: `req-${++reqCounter}`, method, params }, ctx, connectionId);
    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }
    return response.result;
  } finally {
    unsub();
  }
}

describe("fs.* approval gate", () => {
  it("fs.read requests approval (toolName/args/riskLevel) before running, and returns the content once approved", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-approval-"));
    await writeFile(join(workspaceRoot, "secret.txt"), "shh", "utf8");
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);

    const captured: Array<{ requestId: string; toolName: string; args: unknown; riskLevel: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string; args: unknown; riskLevel: string }>(
      "tool.approval.requested",
      (payload) => {
        captured.push(payload);
        void handleGatewayRequest(
          { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
          ctx,
        );
      },
    );

    const response = await handleGatewayRequest(
      { id: "r1", method: "fs.read", params: { relativePath: "secret.txt" } },
      ctx,
    );

    expect(response.result).toMatchObject({ content: "shh" });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      toolName: "fs.read",
      riskLevel: "moderate",
      args: { relativePath: "secret.txt" },
    });
  });

  it("fs.write is denied when the user rejects the approval prompt, and the file is never written", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-approval-deny-"));
    const config = mergeConfig({}, {});

    await expect(
      callFsMethod("fs.write", { relativePath: "nope.txt", content: "x" }, config, workspaceRoot, false),
    ).rejects.toThrow(/denied by user/);

    expect(existsSync(join(workspaceRoot, "nope.txt"))).toBe(false);
  });

  it("fs.delete is denied when the user rejects the approval prompt, riskLevel:destructive", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-approval-deny-delete-"));
    await writeFile(join(workspaceRoot, "keep.txt"), "still here", "utf8");
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);

    const captured: Array<{ riskLevel: string }> = [];
    ctx.events.on<{ requestId: string; riskLevel: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: false } },
        ctx,
      );
    });

    const response = await handleGatewayRequest(
      { id: "r1", method: "fs.delete", params: { relativePath: "keep.txt" } },
      ctx,
    );

    expect(response.error?.message).toMatch(/denied by user/);
    expect(captured[0]?.riskLevel).toBe("destructive");
    expect(existsSync(join(workspaceRoot, "keep.txt"))).toBe(true);
  });
});

describe("fs.list/fs.read loopback approval exemption", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-loopback-"));
    await writeFile(join(workspaceRoot, "hello.txt"), "hi", "utf8");
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "fs.list resolves with no approval prompt over a loopback connection (%s)",
    async (address) => {
      const config = mergeConfig({}, {});
      const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
      registerConnectionRemoteAddress("loop-list", address);

      // No "tool.approval.requested" listener attached at all — if this call
      // gated on approval it would hang until APPROVAL_TIMEOUT_MS, not resolve.
      const response = await handleGatewayRequest({ id: "r1", method: "fs.list", params: {} }, ctx, "loop-list");

      expect(response.error).toBeUndefined();
      expect(response.result).toMatchObject({ entries: [{ name: "hello.txt", type: "file" }] });
    },
  );

  it("fs.read resolves with no approval prompt over a loopback connection", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    registerConnectionRemoteAddress("loop-read", "127.0.0.1");

    const response = await handleGatewayRequest(
      { id: "r1", method: "fs.read", params: { relativePath: "hello.txt" } },
      ctx,
      "loop-read",
    );

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({ content: "hi" });
  });

  it("fs.list still requires approval over a non-loopback connection", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    registerConnectionRemoteAddress("lan-1", "192.168.1.20");

    const captured: Array<{ toolName: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
        ctx,
      );
    });

    const response = await handleGatewayRequest({ id: "r1", method: "fs.list", params: {} }, ctx, "lan-1");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.toolName).toBe("fs.list");
    expect(response.result).toMatchObject({ entries: [{ name: "hello.txt", type: "file" }] });
  });

  it("fs.list still requires approval when the connectionId is unknown/unregistered", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);

    const captured: unknown[] = [];
    ctx.events.on("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: (payload as { requestId: string }).requestId, approved: true } },
        ctx,
      );
    });

    await handleGatewayRequest({ id: "r1", method: "fs.list", params: {} }, ctx, "never-registered");

    expect(captured).toHaveLength(1);
  });

  it("fs.write/fs.mkdir/fs.rename resolve with no approval prompt over a loopback connection", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    registerConnectionRemoteAddress("loop-write", "127.0.0.1");

    // No "tool.approval.requested" listener attached at all — if any of
    // these gated on approval it would hang until APPROVAL_TIMEOUT_MS.
    const writeRes = await handleGatewayRequest(
      { id: "r1", method: "fs.write", params: { relativePath: "new.txt", content: "x" } },
      ctx,
      "loop-write",
    );
    const mkdirRes = await handleGatewayRequest(
      { id: "r2", method: "fs.mkdir", params: { relativePath: "newdir" } },
      ctx,
      "loop-write",
    );
    const renameRes = await handleGatewayRequest(
      { id: "r3", method: "fs.rename", params: { fromRelativePath: "new.txt", toRelativePath: "renamed.txt" } },
      ctx,
      "loop-write",
    );

    expect(writeRes.error).toBeUndefined();
    expect(mkdirRes.error).toBeUndefined();
    expect(renameRes.error).toBeUndefined();
    expect(existsSync(join(workspaceRoot, "renamed.txt"))).toBe(true);
    expect(existsSync(join(workspaceRoot, "newdir"))).toBe(true);
  });

  it("fs.write/fs.mkdir/fs.rename still require approval over a non-loopback connection", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    registerConnectionRemoteAddress("lan-2", "192.168.1.20");

    const captured: Array<{ toolName: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
        ctx,
      );
    });

    await handleGatewayRequest(
      { id: "r1", method: "fs.write", params: { relativePath: "new.txt", content: "x" } },
      ctx,
      "lan-2",
    );

    expect(captured.map((c) => c.toolName)).toEqual(["fs.write"]);
  });

  // fs.delete is the one method that never gets a loopback exception —
  // deleting is irreversible, unlike write/mkdir/rename.
  it("fs.delete still requires approval even over a loopback connection", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    registerConnectionRemoteAddress("loop-delete", "127.0.0.1");

    const captured: Array<{ toolName: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
        ctx,
      );
    });

    await handleGatewayRequest(
      { id: "r1", method: "fs.delete", params: { relativePath: "hello.txt" } },
      ctx,
      "loop-delete",
    );

    expect(captured.map((c) => c.toolName)).toEqual(["fs.delete"]);
  });
});

describe("fs.* trusted-device approval exemption", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-trusted-device-"));
    await writeFile(join(workspaceRoot, "hello.txt"), "hi", "utf8");
  });

  async function registerDevice(ctx: Awaited<ReturnType<typeof createDefaultGatewayContext>>, connectionId: string, deviceId: string) {
    registerConnectionRemoteAddress(connectionId, "192.168.1.30");
    const res = await handleGatewayRequest(
      { id: `reg-${connectionId}`, method: "device.tools.register", params: { deviceId, tools: [] } },
      ctx,
      connectionId,
    );
    expect(res.error).toBeUndefined();
  }

  async function trustDevice(ctx: Awaited<ReturnType<typeof createDefaultGatewayContext>>, deviceId: string, trusted: boolean) {
    registerConnectionRemoteAddress("desktop-loopback", "127.0.0.1");
    const res = await handleGatewayRequest(
      { id: `trust-${deviceId}-${trusted}`, method: "devices.trust.set", params: { deviceId, trusted } },
      ctx,
      "desktop-loopback",
    );
    expect(res.error).toBeUndefined();
  }

  it("skips approval for a device the desktop marked trusted", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    await registerDevice(ctx, "phone-conn-1", "phone-abc");
    await trustDevice(ctx, "phone-abc", true);

    // No "tool.approval.requested" listener at all — a prompt would hang
    // this until APPROVAL_TIMEOUT_MS.
    const response = await handleGatewayRequest({ id: "r1", method: "fs.list", params: {} }, ctx, "phone-conn-1");

    expect(response.error).toBeUndefined();
    // Also contains ".yggdrasil" (directory) — trustDevice's devices.trust.set
    // call just wrote trusted-devices.json there, same as any other project
    // state file under that folder.
    expect((response.result as { entries: unknown[] }).entries).toContainEqual({ name: "hello.txt", type: "file" });
  });

  it("still requires approval for a registered-but-not-trusted device", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    await registerDevice(ctx, "phone-conn-2", "phone-untrusted");

    const captured: Array<{ toolName: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
        ctx,
      );
    });

    await handleGatewayRequest({ id: "r1", method: "fs.list", params: {} }, ctx, "phone-conn-2");

    expect(captured.map((c) => c.toolName)).toEqual(["fs.list"]);
  });

  it("revoking trust makes the very next call on the same connection require approval again", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    await registerDevice(ctx, "phone-conn-3", "phone-revoked");
    await trustDevice(ctx, "phone-revoked", true);

    const first = await handleGatewayRequest({ id: "r1", method: "fs.list", params: {} }, ctx, "phone-conn-3");
    expect(first.error).toBeUndefined();

    await trustDevice(ctx, "phone-revoked", false);

    const captured: Array<{ toolName: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
        ctx,
      );
    });

    await handleGatewayRequest({ id: "r2", method: "fs.list", params: {} }, ctx, "phone-conn-3");
    expect(captured.map((c) => c.toolName)).toEqual(["fs.list"]);
  });

  it("fs.delete still requires approval for a trusted device", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    await registerDevice(ctx, "phone-conn-4", "phone-delete-test");
    await trustDevice(ctx, "phone-delete-test", true);

    const captured: Array<{ toolName: string }> = [];
    ctx.events.on<{ requestId: string; toolName: string }>("tool.approval.requested", (payload) => {
      captured.push(payload);
      void handleGatewayRequest(
        { id: "a1", method: "tools.approve", params: { requestId: payload.requestId, approved: true } },
        ctx,
      );
    });

    await handleGatewayRequest(
      { id: "r1", method: "fs.delete", params: { relativePath: "hello.txt" } },
      ctx,
      "phone-conn-4",
    );
    expect(captured.map((c) => c.toolName)).toEqual(["fs.delete"]);
  });

  it("devices.trust.set/list refuse a non-loopback caller — a device can't trust itself", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    registerConnectionRemoteAddress("stranger", "192.168.1.99");

    const setRes = await handleGatewayRequest(
      { id: "r1", method: "devices.trust.set", params: { deviceId: "phone-self-trust", trusted: true } },
      ctx,
      "stranger",
    );
    expect(setRes.error).toBeDefined();

    const listRes = await handleGatewayRequest({ id: "r2", method: "devices.trust.list", params: {} }, ctx, "stranger");
    expect(listRes.error).toBeDefined();
  });

  it("devices.trust.list reflects what devices.trust.set persisted", async () => {
    const config = mergeConfig({}, {});
    const ctx = await createDefaultGatewayContext(config, null, workspaceRoot);
    await trustDevice(ctx, "phone-listed", true);

    const listRes = await handleGatewayRequest({ id: "r1", method: "devices.trust.list", params: {} }, ctx, "desktop-loopback");
    expect(listRes.result).toMatchObject({ devices: [{ deviceId: "phone-listed" }] });
  });
});

describe("fs.list gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-list-"));
    await mkdir(join(workspaceRoot, "src"));
    await writeFile(join(workspaceRoot, "src", "index.ts"), "// hi", "utf8");
    await writeFile(join(workspaceRoot, "README.md"), "# hi", "utf8");
  });

  it("lists the workspace root by default, directories before files", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.list", {}, config, workspaceRoot)) as {
      path: string;
      entries: Array<{ name: string; type: string }>;
    };
    expect(result.path).toBe("");
    expect(result.entries).toEqual([
      { name: "src", type: "directory" },
      { name: "README.md", type: "file" },
    ]);
  });

  it("lists a subdirectory via relativePath", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.list", { relativePath: "src" }, config, workspaceRoot)) as {
      entries: Array<{ name: string; type: string }>;
    };
    expect(result.entries).toEqual([{ name: "index.ts", type: "file" }]);
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.list", { relativePath: "../../etc" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });

  it("rejects when the gateway has no workspaceRoot", async () => {
    const config = mergeConfig({}, {});
    await expect(callFsMethod("fs.list", {}, config, undefined)).rejects.toThrow(/workspaceRoot/);
  });
});

describe("fs.read gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-read-"));
    await mkdir(join(workspaceRoot, "src"));
    await writeFile(join(workspaceRoot, "src", "index.ts"), "console.log('hi');", "utf8");
  });

  it("reads a file's content via relativePath", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod(
      "fs.read",
      { relativePath: "src/index.ts" },
      config,
      workspaceRoot,
    )) as { path: string; content: string; truncated: boolean };
    expect(result.content).toBe("console.log('hi');");
    expect(result.truncated).toBe(false);
  });

  it("truncates large files and reports totalLength", async () => {
    // Must exceed FS_READ_MAX_CHARS (2,000,000 — raised from 50,000 so a
    // long notes/*.md doesn't hit this in the Documents tab, see its own
    // comment in methods.ts).
    const big = "x".repeat(2_100_000);
    await writeFile(join(workspaceRoot, "big.txt"), big, "utf8");
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.read", { relativePath: "big.txt" }, config, workspaceRoot)) as {
      content: string;
      truncated: boolean;
      totalLength: number;
    };
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(2_000_000);
    expect(result.totalLength).toBe(2_100_000);
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.read", { relativePath: "../../etc/passwd" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });

  it("rejects a missing relativePath", async () => {
    const config = mergeConfig({}, {});
    await expect(callFsMethod("fs.read", {}, config, workspaceRoot)).rejects.toThrow(
      /relativePath is required/,
    );
  });
});

describe("fs.search gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-search-"));
    await mkdir(join(workspaceRoot, "src", "components"), { recursive: true });
    await mkdir(join(workspaceRoot, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(join(workspaceRoot, "src", "components", "Button.tsx"), "", "utf8");
    await writeFile(join(workspaceRoot, "src", "index.ts"), "", "utf8");
    await writeFile(join(workspaceRoot, "node_modules", "some-pkg", "index.js"), "", "utf8");
    await writeFile(join(workspaceRoot, "README.md"), "", "utf8");
  });

  // fs.search deliberately isn't in the approval gate (not part of the point
  // 1 scope) — callFsMethod works fine here too, its approval subscription
  // just never fires.
  it("finds entries matching a query, case-insensitively", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.search", { query: "button" }, config, workspaceRoot)) as {
      entries: Array<{ relativePath: string; type: string }>;
    };
    expect(result.entries).toEqual([{ relativePath: "src/components/Button.tsx", type: "file" }]);
  });

  it("skips node_modules", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.search", { query: "index" }, config, workspaceRoot)) as {
      entries: Array<{ relativePath: string; type: string }>;
    };
    expect(result.entries.some((e) => e.relativePath.includes("node_modules"))).toBe(false);
    expect(result.entries.some((e) => e.relativePath === "src/index.ts")).toBe(true);
  });

  it("returns everything (capped) when query is empty", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.search", {}, config, workspaceRoot)) as {
      entries: Array<{ relativePath: string; type: string }>;
    };
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("respects the limit param", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod("fs.search", { limit: 1 }, config, workspaceRoot)) as {
      entries: Array<{ relativePath: string; type: string }>;
    };
    expect(result.entries.length).toBe(1);
  });
});

// Deliberately no proper xref table (offsets aren't worth hand-computing) —
// pdfjs-dist falls back to scanning the file for objects when the xref is
// missing/broken, which is exactly the code path real-world "slightly off"
// PDFs exercise too. Verified this exact fixture extracts "Hello PDF" via
// dist/documentText.js before writing this test.
const MINIMAL_PDF_WITH_TEXT = Buffer.from(
  [
    "%PDF-1.1",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 100] /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Length 44 >>",
    "stream",
    "BT /F1 24 Tf 10 50 Td (Hello PDF) Tj ET",
    "endstream",
    "endobj",
    "trailer << /Size 6 /Root 1 0 R >>",
    "%%EOF",
    "",
  ].join("\n"),
  "utf8",
);

describe("fs.readDocumentText gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-readdoctext-"));
    await writeFile(join(workspaceRoot, "notes.md"), "# Heading\n\nBody text.", "utf8");
    await writeFile(join(workspaceRoot, "doc.pdf"), MINIMAL_PDF_WITH_TEXT);
    await writeFile(join(workspaceRoot, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("reads a plain text file same as fs.read would", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod(
      "fs.readDocumentText",
      { relativePath: "notes.md" },
      config,
      workspaceRoot,
    )) as { content: string; truncated: boolean };
    expect(result.content).toBe("# Heading\n\nBody text.");
    expect(result.truncated).toBe(false);
  });

  it("extracts text from a PDF instead of returning raw bytes", async () => {
    const config = mergeConfig({}, {});
    const result = (await callFsMethod(
      "fs.readDocumentText",
      { relativePath: "doc.pdf" },
      config,
      workspaceRoot,
    )) as { content: string };
    expect(result.content).toContain("Hello PDF");
  });

  it("rejects a known-unsupported binary type with a clear error", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.readDocumentText", { relativePath: "photo.png" }, config, workspaceRoot),
    ).rejects.toThrow(/no text representation/);
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.readDocumentText", { relativePath: "../../etc/passwd" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });
});

describe("fs.readBinary gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-readbinary-"));
  });

  it("round-trips binary content as base64", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    await writeFile(join(workspaceRoot, "img.png"), bytes);
    const config = mergeConfig({}, {});
    const result = (await callFsMethod(
      "fs.readBinary",
      { relativePath: "img.png" },
      config,
      workspaceRoot,
    )) as { base64: string; truncated: boolean; totalBytes: number };
    expect(result.truncated).toBe(false);
    expect(result.totalBytes).toBe(bytes.length);
    expect(Buffer.from(result.base64, "base64").equals(bytes)).toBe(true);
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.readBinary", { relativePath: "../../etc/passwd" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });

  it("rejects a missing relativePath", async () => {
    const config = mergeConfig({}, {});
    await expect(callFsMethod("fs.readBinary", {}, config, workspaceRoot)).rejects.toThrow(
      /relativePath is required/,
    );
  });
});

describe("fs.write gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-write-"));
  });

  it("writes a new file's content", async () => {
    const config = mergeConfig({}, {});
    await callFsMethod(
      "fs.write",
      { relativePath: "notes/hello.md", content: "# hi" },
      config,
      workspaceRoot,
    );
    expect(await readFile(join(workspaceRoot, "notes", "hello.md"), "utf8")).toBe("# hi");
  });

  it("overwrites an existing file", async () => {
    await mkdir(join(workspaceRoot, "src"));
    await writeFile(join(workspaceRoot, "src", "a.ts"), "old", "utf8");
    const config = mergeConfig({}, {});
    await callFsMethod("fs.write", { relativePath: "src/a.ts", content: "new" }, config, workspaceRoot);
    expect(await readFile(join(workspaceRoot, "src", "a.ts"), "utf8")).toBe("new");
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.write", { relativePath: "../evil.txt", content: "x" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });
});

describe("fs.mkdir gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-mkdir-"));
  });

  it("creates a nested directory", async () => {
    const config = mergeConfig({}, {});
    await callFsMethod("fs.mkdir", { relativePath: "a/b/c" }, config, workspaceRoot);
    expect(existsSync(join(workspaceRoot, "a", "b", "c"))).toBe(true);
  });

  it("is a no-op when the directory already exists", async () => {
    await mkdir(join(workspaceRoot, "notes"));
    const config = mergeConfig({}, {});
    await expect(callFsMethod("fs.mkdir", { relativePath: "notes" }, config, workspaceRoot)).resolves.toBeTruthy();
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.mkdir", { relativePath: "../evil" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });
});

describe("fs.rename gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-rename-"));
    await writeFile(join(workspaceRoot, "old.txt"), "hi", "utf8");
  });

  it("renames a file", async () => {
    const config = mergeConfig({}, {});
    await callFsMethod(
      "fs.rename",
      { fromRelativePath: "old.txt", toRelativePath: "new.txt" },
      config,
      workspaceRoot,
    );
    expect(existsSync(join(workspaceRoot, "old.txt"))).toBe(false);
    expect(await readFile(join(workspaceRoot, "new.txt"), "utf8")).toBe("hi");
  });

  it("rejects a fromRelativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod(
        "fs.rename",
        { fromRelativePath: "../../etc/passwd", toRelativePath: "new.txt" },
        config,
        workspaceRoot,
      ),
    ).rejects.toThrow(/escapes/);
  });

  it("rejects a toRelativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod(
        "fs.rename",
        { fromRelativePath: "old.txt", toRelativePath: "../evil.txt" },
        config,
        workspaceRoot,
      ),
    ).rejects.toThrow(/escapes/);
  });
});

describe("fs.delete gateway method", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-fs-delete-"));
    await mkdir(join(workspaceRoot, "src", "sub"), { recursive: true });
    await writeFile(join(workspaceRoot, "src", "a.ts"), "", "utf8");
    await writeFile(join(workspaceRoot, "src", "sub", "b.ts"), "", "utf8");
  });

  it("deletes a file", async () => {
    const config = mergeConfig({}, {});
    await callFsMethod("fs.delete", { relativePath: "src/a.ts" }, config, workspaceRoot);
    expect(existsSync(join(workspaceRoot, "src", "a.ts"))).toBe(false);
  });

  it("deletes a directory recursively", async () => {
    const config = mergeConfig({}, {});
    await callFsMethod("fs.delete", { relativePath: "src" }, config, workspaceRoot);
    expect(existsSync(join(workspaceRoot, "src"))).toBe(false);
  });

  it("rejects a relativePath that escapes the workspace root", async () => {
    const config = mergeConfig({}, {});
    await expect(
      callFsMethod("fs.delete", { relativePath: "../../etc" }, config, workspaceRoot),
    ).rejects.toThrow(/escapes/);
  });
});
