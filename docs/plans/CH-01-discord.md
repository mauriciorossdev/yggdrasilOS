# CH-01 — Discord Channel Plugin

**Roadmap ref:** Fase 1 / CH-01  
**Paquete destino:** `extensions/channel-discord`  
**Dependencias:** ninguna de otras fases  

---

## Diseño

Un bot de Discord conectado via Gateway WebSocket. Una cuenta = un bot token.  
Cada canal de Discord (`channelId`) es una sesión independiente.

```
Discord Gateway (WSS)
  → messageCreate event
  → buildSessionKey("discord", accountId, channelId)
  → onInbound(message)
  → pipeline → harness → LLM
  → sendFinal(ctx, final)
  → client.channels.cache.get(channelId).send(text)
```

**Sin streaming** — Discord no soporta edición parcial en tiempo real en v1.  
**`deliveryMode: "direct"`** — mismo patrón que Telegram.

### sessionKey → channelId routing

Discord necesita saber a qué canal responder a partir del `sessionKey`.  
Se parsea con la misma convención que Telegram: `"discord:accountId:channelId"`.

---

## Estructura de archivos

```
extensions/channel-discord/
├── package.json
├── tsconfig.json
├── yggdrasil.plugin.json
└── src/
    ├── index.ts         ← plugin entry
    └── discord.ts       ← lógica del cliente
```

---

## Config

En `yggdrasil.config.json`:

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "...",
          "allowedChannelIds": [],
          "prefix": ""
        }
      }
    }
  }
}
```

Variables de entorno como alternativa al token en config:
- `DISCORD_BOT_TOKEN`

`allowedChannelIds`: array de IDs de canal permitidos. Vacío = todos.  
`prefix`: si se setea (ej `"!"`), el bot solo responde a mensajes que empiecen con ese prefijo.

---

## Implementación

### `package.json`

```json
{
  "name": "@yggdrasil/channel-discord",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@yggdrasil/sdk": "workspace:*",
    "@yggdrasil/config": "workspace:*",
    "discord.js": "^14.16.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  },
  "files": ["dist"]
}
```

### `yggdrasil.plugin.json`

```json
{
  "id": "channel-discord",
  "name": "Discord Channel",
  "version": "0.1.0",
  "kind": ["channel"],
  "entry": "./dist/index.js",
  "compat": { "pluginApi": ">=0.3.0" }
}
```

### `src/discord.ts`

```typescript
import {
  Client,
  GatewayIntentBits,
  type TextChannel,
  type Message,
} from "discord.js";
import { buildSessionKey } from "@yggdrasil/config";
import type {
  ChannelPlugin,
  NormalizedInboundMessage,
  OutboundContext,
  OutboundFinal,
} from "@yggdrasil/sdk";

type DiscordAccountConfig = {
  botToken?: string;
  allowedChannelIds?: string[];
  prefix?: string;
};

type AccountState = {
  client: Client;
};

const accountStates = new Map<string, AccountState>();

function resolveToken(cfg: DiscordAccountConfig, accountId: string): string {
  const token = cfg.botToken?.trim() || process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new Error(`Discord botToken required (config or DISCORD_BOT_TOKEN) for account ${accountId}`);
  return token;
}

function parseChannelId(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "discord") return undefined;
  return parts.slice(2).join(":");
}

export const discordChannel: ChannelPlugin = {
  id: "discord",
  meta: { label: "Discord", order: 20, description: "Discord bot channel" },
  capabilities: { inbound: true, outbound: true, streaming: false, interactive: false },

  config: {
    listAccountIds() { return ["default"]; },
    resolveAccount(accountId) { return { accountId }; },
  },

  gateway: {
    async startAccount(ctx) {
      const pluginCfg = ctx.globalConfig as Record<string, unknown> | undefined;
      const channelsCfg = pluginCfg?.channels as Record<string, unknown> | undefined;
      const discordCfg  = channelsCfg?.discord as Record<string, unknown> | undefined;
      const accounts    = discordCfg?.accounts as Record<string, DiscordAccountConfig> | undefined;
      const accountCfg: DiscordAccountConfig = accounts?.[ctx.accountId] ?? {};

      const token = resolveToken(accountCfg, ctx.accountId);
      const allowedChannelIds = accountCfg.allowedChannelIds ?? [];
      const prefix = accountCfg.prefix ?? "";

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      client.on("messageCreate", async (msg: Message) => {
        if (msg.author.bot) return;

        const channelId = msg.channelId;
        if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(channelId)) return;

        let body = msg.content;
        if (prefix) {
          if (!body.startsWith(prefix)) return;
          body = body.slice(prefix.length).trim();
        }
        if (!body) return;

        const sessionKey = buildSessionKey("discord", ctx.accountId, channelId);
        const inbound: NormalizedInboundMessage = {
          channelId: "discord",
          accountId: ctx.accountId,
          sessionKey,
          senderId: msg.author.id,
          body,
          timestamp: msg.createdTimestamp,
        };

        await ctx.onInbound(inbound);
      });

      ctx.abortSignal.addEventListener("abort", () => {
        client.destroy();
        accountStates.delete(ctx.accountId);
      });

      await client.login(token);
      accountStates.set(ctx.accountId, { client });
    },

    async stopAccount(ctx) {
      const state = accountStates.get(ctx.accountId);
      if (state) {
        state.client.destroy();
        accountStates.delete(ctx.accountId);
      }
    },
  },

  outbound: {
    deliveryMode: "direct",

    async sendFinal(ctx: OutboundContext, final: OutboundFinal) {
      const state = accountStates.get(ctx.accountId);
      if (!state) return;

      const channelId = parseChannelId(ctx.sessionKey);
      if (!channelId) return;

      const channel = state.client.channels.cache.get(channelId) as TextChannel | undefined;
      if (!channel) return;

      // Discord limit: 2000 chars per message
      const chunks = splitMessage(final.text, 2000);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    },
  },
};

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    // Try to split on newline within limit
    let cut = limit;
    if (remaining.length > limit) {
      const nl = remaining.lastIndexOf("\n", limit);
      if (nl > 0) cut = nl + 1;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks;
}
```

### `src/index.ts`

```typescript
import { definePlugin } from "@yggdrasil/sdk";
import { discordChannel } from "./discord.js";

const plugin = definePlugin({
  id: "channel-discord",
  name: "Discord Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(discordChannel);
    api.logger.info("registered channel", { id: "discord" });
  },
});

export default plugin;
```

---

## Setup

```bash
cd extensions/channel-discord
pnpm install
pnpm build
```

En `yggdrasil.config.json`:
```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "TOKEN_AQUI"
        }
      }
    }
  }
}
```

O via env var:
```bash
export DISCORD_BOT_TOKEN=TOKEN_AQUI
```

### Permisos del bot en Discord Developer Portal

- **Scopes:** `bot`
- **Bot Permissions:** `Send Messages`, `Read Message History`, `View Channels`
- **Privileged Intents:** `MESSAGE CONTENT INTENT` (obligatorio para leer el texto)

---

## Testing

1. Crear bot en https://discord.com/developers/applications
2. Activar `MESSAGE CONTENT INTENT`
3. Invitar bot al servidor
4. Iniciar gateway: `node packages/cli/dist/index.js run`
5. Escribir mensaje en canal de Discord
6. Verificar respuesta del agente

Test de `splitMessage`:
- Input >2000 chars → múltiples chunks, cada uno ≤2000
- Split preferentemente en newline

---

## Consideraciones

- **MessageContent intent** es privilegiado — Discord lo aprueba automáticamente para bots con <100 servidores
- **Sin streaming** — Discord no soporta edición en tiempo real; la respuesta llega completa
- **Rate limiting** — discord.js maneja automáticamente el rate limiting de la API
- **Multi-server** — el mismo bot puede estar en múltiples servers; cada canal tiene su propia sesión
- **Threads** — no soportados en v1; solo canales de texto normales
