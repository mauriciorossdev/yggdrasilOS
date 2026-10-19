import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";
import { htmlToText } from "./html.js";

const MAX_BYTES = 32_000;

const httpFetchTool = defineTool({
  name: "http_fetch",
  description:
    "Make an HTTP request and return the response. " +
    "Lighter than browser_navigate — no JS execution. " +
    "Best for REST APIs (JSON), static HTML pages, and any HTTP endpoint. " +
    "HTML responses are automatically converted to readable text.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL including protocol",
      },
      method: {
        type: "string",
        description: "HTTP method: GET, POST, PUT, PATCH, DELETE (default: GET)",
      },
      headers: {
        type: "object",
        description: "Additional request headers as key-value pairs",
      },
      body: {
        type: "string",
        description: "Request body for POST/PUT/PATCH (string or JSON string)",
      },
      rawHtml: {
        type: "boolean",
        description: "Return raw HTML instead of extracted text (default: false)",
      },
    },
    required: ["url"],
  },
  async execute(_ctx, args) {
    const url = String(args.url);
    const method = typeof args.method === "string" ? args.method.toUpperCase() : "GET";
    const rawHtml = args.rawHtml === true;

    const headers: Record<string, string> = {
      "User-Agent": "Yggdrasil/0.1 (bot; http-fetch-tool)",
      ...(typeof args.headers === "object" && args.headers !== null
        ? (args.headers as Record<string, string>)
        : {}),
    };

    const init: RequestInit = { method, headers };
    if (args.body !== undefined && ["POST", "PUT", "PATCH"].includes(method)) {
      init.body = String(args.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const res = await fetch(url, init);
    const contentType = res.headers.get("content-type") ?? "";

    // Read body up to MAX_BYTES
    const arrayBuf = await res.arrayBuffer();
    const raw = Buffer.from(arrayBuf).toString("utf-8").slice(0, MAX_BYTES);
    const truncated = Buffer.byteLength(raw, "utf-8") >= MAX_BYTES;

    let body: unknown;
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else if (contentType.includes("text/html") && !rawHtml) {
      body = htmlToText(raw).slice(0, MAX_BYTES);
    } else {
      body = raw;
    }

    return {
      status: res.status,
      ok: res.ok,
      contentType,
      url: res.url,
      body,
      truncated,
    };
  },
});

const plugin = definePlugin({
  id: "tool-fetch",
  name: "HTTP Fetch",
  version: "0.1.0",
  register(api) {
    api.registerTool(httpFetchTool);
  },
});

export default plugin;
