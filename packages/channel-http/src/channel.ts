import { createServer, type Server, type ServerResponse } from "node:http";
import {
  buildSessionKey,
  parseBearerToken,
  resolveHttpApiKey,
  validateApiKey,
  type YggdrasilConfig,
} from "@yggdrasil/config";
import {
  definePlugin,
  type ChannelGatewayStartContext,
  type ChannelPlugin,
  type NormalizedInboundMessage,
  type OutboundContext,
} from "@yggdrasil/sdk";

export type HttpAccountConfig = {
  port?: number;
  host?: string;
  token?: string;
};

type PendingReply = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  onDelta?: (text: string) => void;
  sse?: boolean;
};

type HttpServerState = {
  server: Server;
  port: number;
  pendingReplies: Map<string, PendingReply>;
};

const servers = new Map<string, HttpServerState>();

function accountKey(accountId: string): string {
  return `http:${accountId}`;
}

function parseBody(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readJson(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function resolveGlobalConfig(ctx: ChannelGatewayStartContext): YggdrasilConfig {
  return (ctx.globalConfig ?? {}) as YggdrasilConfig;
}

function checkHttpAuth(
  config: YggdrasilConfig,
  accountId: string,
  authorization: string | undefined,
): boolean {
  const expected = resolveHttpApiKey(config, accountId);
  if (!expected) return true;
  return validateApiKey(parseBearerToken(authorization), expected);
}

export const httpChannel: ChannelPlugin = {
  id: "http",
  meta: { label: "HTTP Webhook", order: 10, description: "Inbound HTTP webhook channel" },
  capabilities: { inbound: true, outbound: true, streaming: true },
  config: {
    listAccountIds() {
      return ["default"];
    },
    resolveAccount(accountId) {
      return { accountId };
    },
  },
  gateway: {
    async startAccount(ctx: ChannelGatewayStartContext): Promise<void> {
      const key = accountKey(ctx.accountId);
      if (servers.has(key)) return;

      const accountCfg = (ctx.config ?? {}) as HttpAccountConfig;
      const port = accountCfg.port ?? 18790;
      const host = accountCfg.host ?? "127.0.0.1";

      const pendingReplies = new Map<string, PendingReply>();

      const server = createServer(async (req, res) => {
        if (req.method !== "POST" || req.url !== "/inbound") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const globalConfig = resolveGlobalConfig(ctx);
        if (!checkHttpAuth(globalConfig, ctx.accountId, req.headers.authorization)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }

        try {
          const raw = await readJson(req);
          const body = parseBody(raw);
          const messageText = String(body.message ?? body.text ?? "");
          const senderId = String(body.senderId ?? "http-client");
          const sessionKey = String(
            body.sessionKey ?? buildSessionKey("http", ctx.accountId, senderId),
          );

          const accept = req.headers.accept ?? "";
          const wantsStream = accept.includes("text/event-stream");

          const replyPromise = new Promise<string>((resolve, reject) => {
            const pending: PendingReply = { resolve, reject };
            if (wantsStream) {
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              });
              pending.sse = true;
              pending.onDelta = (text) => writeSse(res, "delta", { text });
            }
            pendingReplies.set(sessionKey, pending);
          });

          const inbound: NormalizedInboundMessage = {
            channelId: "http",
            accountId: ctx.accountId,
            sessionKey,
            senderId,
            body: messageText,
            timestamp: Date.now(),
          };

          await ctx.onInbound(inbound);

          const reply = await Promise.race([
            replyPromise,
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("Reply timeout")), 30_000),
            ),
          ]);

          const pending = pendingReplies.get(sessionKey);
          if (pending?.sse) {
            writeSse(res, "final", { reply, sessionKey });
            res.end();
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ reply, sessionKey }));
          }
          pendingReplies.delete(sessionKey);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
          }
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(port, host, () => resolve());
        server.on("error", reject);
      });

      servers.set(key, { server, port, pendingReplies });

      ctx.abortSignal.addEventListener("abort", () => {
        server.close();
        servers.delete(key);
      });
    },

    async stopAccount(ctx): Promise<void> {
      const key = accountKey(ctx.accountId);
      const state = servers.get(key);
      if (state) {
        await new Promise<void>((resolve) => state.server.close(() => resolve()));
        servers.delete(key);
      }
    },
  },
  outbound: {
    deliveryMode: "direct",
    async sendBlock(ctx: OutboundContext, block) {
      const state = servers.get(accountKey(ctx.accountId));
      const pending = state?.pendingReplies.get(ctx.sessionKey);
      if (pending?.onDelta) {
        pending.onDelta(block.text);
      }
    },
    async sendFinal(ctx: OutboundContext, final) {
      const state = servers.get(accountKey(ctx.accountId));
      const pending = state?.pendingReplies.get(ctx.sessionKey);
      if (pending) {
        pending.resolve(final.text);
        if (!pending.sse) {
          state?.pendingReplies.delete(ctx.sessionKey);
        }
      }
    },
  },
};

export const httpChannelPlugin = definePlugin({
  id: "channel-http",
  name: "HTTP Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(httpChannel);
  },
});

export default httpChannelPlugin;
