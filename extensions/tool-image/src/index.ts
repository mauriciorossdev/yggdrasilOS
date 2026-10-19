import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const imageViewTool = defineTool({
  name: "image_view",
  description:
    "Load a local image file and show it to the model. " +
    "Requires a vision-capable model (e.g. gpt-4o, claude-3-opus). " +
    "Supported formats: PNG, JPEG, GIF, WebP, BMP.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the image file" },
    },
    required: ["path"],
  },
  async execute(_ctx, args) {
    const absPath = resolve(String(args.path));
    const ext = extname(absPath).toLowerCase();
    const mimeType = MIME[ext];
    if (!mimeType) {
      throw new Error(`Unsupported image format: ${ext}. Supported: ${Object.keys(MIME).join(", ")}`);
    }
    const buf = await readFile(absPath);
    const base64 = buf.toString("base64");
    // Return image sentinel — tool-loop detects __ygg_image__ and injects as multimodal user message
    return { __ygg_image__: true, base64, mimeType, path: absPath };
  },
});

const imageViewUrlTool = defineTool({
  name: "image_view_url",
  description:
    "Fetch an image from a URL and show it to the model. " +
    "Requires a vision-capable model (e.g. gpt-4o, claude-3-opus).",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public URL of the image" },
    },
    required: ["url"],
  },
  async execute(_ctx, args) {
    const url = String(args.url);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") ?? "image/png";
    const mimeType = contentType.split(";")[0]!.trim();
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");
    return { __ygg_image__: true, base64, mimeType, path: url };
  },
});

const plugin = definePlugin({
  id: "tool-image",
  name: "Image Input",
  version: "0.1.0",
  register(api) {
    api.registerTool(imageViewTool);
    api.registerTool(imageViewUrlTool);
  },
});

export default plugin;
