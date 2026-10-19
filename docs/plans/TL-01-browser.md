# TL-01 — Browser Automation Tool

**Roadmap ref:** Fase 2 / TL-01  
**Paquete destino:** `extensions/tool-browser`  
**Dependencias:** ninguna (no requiere F3-01 para la versión headless)  
**Impacto:** desbloquea web research, scraping, form filling, screenshots para el agente

---

## Qué construir

Plugin `kind: tool` con 5 herramientas Playwright headless:

| Tool name | Risk | Descripción |
|-----------|------|-------------|
| `browser_navigate` | safe | Abre URL, devuelve título + texto de la página |
| `browser_screenshot` | safe | Captura screenshot → base64 PNG |
| `browser_click` | moderate | Click en selector CSS |
| `browser_fill` | moderate | Rellena input con texto |
| `browser_extract` | safe | Extrae texto/atributo de selector CSS |

Una sola instancia de browser Playwright se reutiliza por sesión (pool simple). Se cierra al detener el gateway.

---

## Estructura de archivos

```
extensions/tool-browser/
├── package.json
├── tsconfig.json
├── yggdrasil.plugin.json
└── src/
    ├── index.ts          ← plugin entry, registra las 5 tools
    ├── browser-pool.ts   ← singleton Browser + Page por sessionKey
    └── tools/
        ├── navigate.ts
        ├── screenshot.ts
        ├── click.ts
        ├── fill.ts
        └── extract.ts
```

---

## Implementación

### `package.json`

```json
{
  "name": "@yggdrasil/tool-browser",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@yggdrasil/sdk": "workspace:*",
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
```

### `yggdrasil.plugin.json`

```json
{
  "id": "tool-browser",
  "name": "Browser Automation",
  "version": "0.1.0",
  "kind": ["tool", "service"],
  "entry": "./dist/index.js",
  "compat": { "pluginApi": ">=0.3.0" }
}
```

### `src/browser-pool.ts`

```typescript
import { chromium, type Browser, type Page } from "playwright";

const pages = new Map<string, Page>();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

export async function getPage(sessionKey: string): Promise<Page> {
  if (!pages.has(sessionKey)) {
    const b = await getBrowser();
    const ctx = await b.newContext();
    pages.set(sessionKey, await ctx.newPage());
  }
  return pages.get(sessionKey)!;
}

export async function closeAll(): Promise<void> {
  await browser?.close();
  browser = null;
  pages.clear();
}
```

### `src/tools/navigate.ts`

```typescript
import { defineTool } from "@yggdrasil/sdk";
import { getPage } from "../browser-pool.js";

export const navigateTool = defineTool({
  name: "browser_navigate",
  description: "Navigate to a URL and return the page title and visible text content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL including protocol" },
    },
    required: ["url"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    await page.goto(String(args.url), { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    const text = await page.evaluate(() =>
      document.body?.innerText?.slice(0, 8000) ?? ""
    );
    return { title, url: page.url(), text };
  },
});
```

### `src/tools/screenshot.ts`

```typescript
import { defineTool } from "@yggdrasil/sdk";
import { getPage } from "../browser-pool.js";

export const screenshotTool = defineTool({
  name: "browser_screenshot",
  description: "Take a screenshot of the current page. Returns base64 PNG.",
  parameters: { type: "object", properties: {} },
  async execute(ctx) {
    const page = await getPage(ctx.sessionKey);
    const buf = await page.screenshot({ type: "png", fullPage: false });
    return { base64: buf.toString("base64"), mimeType: "image/png" };
  },
});
```

### `src/tools/click.ts`

```typescript
import { defineTool } from "@yggdrasil/sdk";
import { getPage } from "../browser-pool.js";

export const clickTool = defineTool({
  name: "browser_click",
  description: "Click an element by CSS selector.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of element to click" },
    },
    required: ["selector"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    await page.click(String(args.selector), { timeout: 5000 });
    return { clicked: true, selector: args.selector };
  },
});
```

### `src/tools/fill.ts`

```typescript
import { defineTool } from "@yggdrasil/sdk";
import { getPage } from "../browser-pool.js";

export const fillTool = defineTool({
  name: "browser_fill",
  description: "Fill a text input with a value.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of input element" },
      value:    { type: "string", description: "Text to type into the input" },
    },
    required: ["selector", "value"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    await page.fill(String(args.selector), String(args.value));
    return { filled: true, selector: args.selector };
  },
});
```

### `src/tools/extract.ts`

```typescript
import { defineTool } from "@yggdrasil/sdk";
import { getPage } from "../browser-pool.js";

export const extractTool = defineTool({
  name: "browser_extract",
  description: "Extract text or attribute from elements matching a CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector:  { type: "string", description: "CSS selector" },
      attribute: { type: "string", description: "HTML attribute to extract (omit for innerText)" },
      limit:     { type: "number", description: "Max elements to return (default 10)" },
    },
    required: ["selector"],
  },
  async execute(ctx, args) {
    const page = await getPage(ctx.sessionKey);
    const attr = args.attribute ? String(args.attribute) : null;
    const limit = typeof args.limit === "number" ? args.limit : 10;
    const results = await page.evaluate(
      ({ sel, a, lim }) => {
        const els = Array.from(document.querySelectorAll(sel)).slice(0, lim);
        return els.map(el => a ? (el as HTMLElement).getAttribute(a) : (el as HTMLElement).innerText);
      },
      { sel: String(args.selector), a: attr, lim: limit }
    );
    return { results };
  },
});
```

### `src/index.ts`

```typescript
import { definePlugin } from "@yggdrasil/sdk";
import { closeAll } from "./browser-pool.js";
import { navigateTool }  from "./tools/navigate.js";
import { screenshotTool } from "./tools/screenshot.js";
import { clickTool }     from "./tools/click.js";
import { fillTool }      from "./tools/fill.js";
import { extractTool }   from "./tools/extract.js";

export default definePlugin({
  id: "tool-browser",
  register(api) {
    api.registerTool(navigateTool);
    api.registerTool(screenshotTool);
    api.registerTool(clickTool);
    api.registerTool(fillTool);
    api.registerTool(extractTool);

    // Cierra el browser al detener el gateway
    api.registerService({
      id: "browser-pool-cleanup",
      async start() {},
      async stop() { await closeAll(); },
    });
  },
});
```

---

## tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

---

## Setup post-install

Playwright requiere descargar Chromium la primera vez:

```bash
cd extensions/tool-browser
pnpm install
pnpm exec playwright install chromium
pnpm build
```

Agregar al `yggdrasil.config.json`:

```json
{
  "plugins": {
    "load": { "paths": ["extensions"] }
  }
}
```

El plugin se descubre automáticamente desde `extensions/`.

---

## Testing

**Test manual:**
```
Usuario: "Ve a https://example.com y dime el título"
Agente llama: browser_navigate({ url: "https://example.com" })
Resultado esperado: { title: "Example Domain", url: "...", text: "..." }
```

**Test de aprobación:**
```
Usuario: "Clickea el botón de submit en example.com"
Agente llama: browser_click({ selector: "button[type=submit]" })
→ approval prompt (riskLevel: "moderate")
→ usuario aprueba → executa
```

**Test de extracción:**
```
Usuario: "Extrae todos los links de la página actual"
Agente llama: browser_extract({ selector: "a", attribute: "href" })
Resultado: { results: ["https://...", ...] }
```

**Unit test sugerido:** `extensions/tool-browser/src/browser.test.ts`
- Mock `getPage` con un objeto Page falso
- Verificar que navigate devuelve `{ title, url, text }`
- Verificar que extract aplica el límite correctamente

---

## Consideraciones

- **Timeout:** `browser_navigate` usa 15s. `browser_click` usa 5s. Suficiente para páginas normales.
- **Una page por sessionKey:** conversaciones distintas tienen browsers aislados.
- **No se persiste estado entre gateway restarts** — el browser se crea fresco.
- **Screenshots y multimodal:** `browser_screenshot` devuelve base64. Útil cuando el provider soporta visión (gpt-4o, claude-3). Sin visión, el agente debe usar `browser_extract` en su lugar.
- **Playwright headless:** no abre ventana. Compatible con servidores sin display.
