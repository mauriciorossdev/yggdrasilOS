# Investigación competitiva — plataformas de orquestación de agentes de IA

> Comparación de Yggdrasil (este proyecto) contra software similar en el espacio de orquestación de agentes de codificación y multi-agente. Escrito 2026-09-16.

## 1. Qué tenemos nosotros (Yggdrasil)

**Qué es:** plataforma modular de orquestación de agentes (kernel de plugins: channels, harnesses, providers, tools, context sources) con un gateway WebSocket/HTTP (`packages/gateway`, puerto 18789) y un cliente de escritorio Electron (`packages/app-desktop`, Windows/Mac/Linux).

**Features actuales:**
- **Terminal multi-sesión** — panes de terminal (xterm + node-pty) con layout en árbol (`paneTree.ts`), splits, dock minimizado, captura de buffer.
- **Chat multi-sesión** — sidebar de sesiones, aprobación de tool-calls (`ApprovalBar`), markdown, contexto por proyecto.
- **Agent Flow (canvas)** — construido sobre `@xyflow/react`: nodos de agente + un nodo supervisor, edges/conexiones, plantillas de agente, "Teams" guardados (guardar/abrir un flujo completo por nombre), ejecución de flujo que reparte trabajo del supervisor a los workers vía delegación.
- **Projects** — gestión de proyectos locales, deep-link cross-app.
- **Tools/MCP** — `tool-mcp` puentea servidores MCP externos como tools del agente; `tool-google` (Gmail/Calendar/Drive, OAuth "gateway-initiated-by-phone"); `tool-system`, `tool-weather`, `tool-documents`, `tool-cli-delegate` (delega a un CLI de `claude`/`agy` headless con sesiones persistentes).
- **Channels** — TUI, HTTP, Telegram, Discord, Slack (ver `docs/*-channel.md`), Web Console.
- **Sessions** — compaction, presupuesto de tokens, persistencia.
- **Multi-provider LLM** — Ollama Cloud y OpenAI-compatible.

**UI paradigm:** app de escritorio nativa (Electron) que combina terminal + chat + flow-canvas visual en una sola ventana con barra de título personalizada (frameless).

**Pricing / open-source:** repo privado (`private: true`, sin `LICENSE` en el root) alojado en GitHub bajo cuenta personal — **no es open-source formalmente** (sin licencia publicada) ni tiene modelo de pricing definido todavía (proyecto propio, uso interno/personal). No cobra por el uso del LLM: usa tus propias credenciales (Ollama Cloud/OpenAI).

---

## 2. "Grok" y "Orca" — a qué producto real corresponden

El usuario los mencionó de memoria; investigación confirma que ambos existen como productos reales y encajan en la categoría:

- **"Grok" → Grok Build (xAI).** CLI de agente de codificación de xAI que puede lanzar hasta 8 sub-agentes en paralelo (cada uno en su propio git worktree/branch), con un "Agent Dashboard" (terminal-based, lanzado 15 jun 2026) para monitorear sesiones paralelas, modo "Arena" que rankea outputs de agentes compitiendo entre sí, y ejecución local-first (no envía código a servidores de xAI). Es primariamente CLI, no tiene canvas visual — hay UIs de terceros (MindStudio) que exponen modelos Grok en flow builders, pero eso no es de xAI. [Grok Build review](https://www.buildfastwithai.com/blogs/grok-build-xai-cli-ai-agents-2026) · [xAI enters coding agent race](https://devops.com/xai-enters-the-coding-agent-race-with-grok-build/) · [Agent Dashboard](https://techjacksolutions.com/ai-brief/xais-grok-build-agent-dashboard-manage-eight-parallel-coding/)

- **"Orca" → Orca (Stably AI, YC W22).** Coincide casi exactamente con el concepto: "Agent Development Environment" (ADE) de escritorio para correr una flota de agentes de codificación en paralelo (Claude Code, Codex, OpenCode, Grok, Cursor, Pi, +40 agentes CLI), cada uno en su propio git worktree aislado. Terminal propia (clase Ghostty), "Design Mode" (click en un elemento de una ventana Chromium embebida y su HTML/CSS/screenshot van directo al prompt del agente), integración GitHub/Linear, SSH worktrees para correr agentes en remoto, y compañero móvil (iOS/Android, beta) para orquestar desde el teléfono. **Open source, licencia MIT**, sin capa de markup — usas tus propias suscripciones. [GitHub stablyai/orca](https://github.com/stablyai/orca) · [Orca Docs](https://www.onorca.dev/docs) · [Aridane Martín — cómo orquestar con Orca](https://aridanemartin.dev/blog/orca-orchestrate-agents/) · [MOGE — Orca product page](https://moge.ai/product/orca)

Nota: hay un segundo proyecto llamado "Orca" (un DSL para orquestación de agentes, [ThakeeNathees/orca](https://github.com/ThakeeNathees/orca)) — mucho menos relevante, probablemente no es al que se refería el usuario.

---

## 3. Otros comparables encontrados

| Producto | Qué es | UI | Pricing | Open source | Supervisión multi-agente |
|---|---|---|---|---|---|
| **Conductor** (Melty Labs) | App de escritorio (Mac) para correr Claude Code/Codex/Cursor en paralelo | Desktop nativa, diff viewer, PR flow | Free (local) · Pro $50/mes (cloud, multiplayer 5 personas, API, móvil) · Teams $60/usuario · Enterprise custom | No (comercial, $22M Series A) | Cada workspace = git worktree aislado; sin flow-canvas visual |
| **LangGraph Studio** (LangChain) | IDE visual para grafos de agentes con estado (statechart-like) | Web-based studio (parte de LangSmith) | Framework LangGraph: gratis y open source. Studio: gratis en beta con cuenta LangSmith; LangSmith Plus $39/asiento/mes + uso | Sí (framework), Studio es parte de plataforma cloud | Grafos explícitos (nodes/edges) con estado compartido — el patrón más cercano al nuestro (canvas de nodos) |
| **AutoGen / AutoGen Studio** (Microsoft) | Framework de conversaciones multi-agente + Studio no-code para diseñar/testear workflows visualmente | GUI no-code (Studio) | Completamente gratis, MIT | Sí, MIT — pero AutoGen está en modo mantenimiento (2026), evolucionó a "Microsoft Agent Framework" (unifica AutoGen + Semantic Kernel, lanzado abr 2026) | Conversaciones agente-a-agente configurables visualmente |
| **Flowise** | Builder visual drag-and-drop de flujos LLM/agentes (tipo n8n para IA) | Canvas drag-and-drop | Self-host: $0 (Apache 2.0). Cloud: Free $0 · Starter $35/mes (10k predicciones) · Pro $65/mes (50k, workspaces, roles) | Sí, Apache 2.0 — **pero el repo entró en code-freeze 29 jul 2026 y se archiva 10 ago 2026**, soporte core termina 31 ago 2026 | Multi-agente vía nodos conectados en canvas |
| **CrewAI / CrewAI Studio** | Framework de "crews" de agentes con roles + Studio no-code (parte de CrewAI Enterprise AMP) | Drag-and-drop no-code (Studio), genera código Python real exportable | Framework: gratis para siempre (open source). AMP: Basic free (50 ejecuciones/mes, luego $0.50 c/u) → Enterprise custom | Framework sí; Studio es parte de la plataforma comercial AMP | Roles predefinidos (agente, tarea, crew) + conectores prearmados (Gmail, Teams, Notion, HubSpot, Salesforce, Slack) |
| **Warp** | Terminal "agentic" (Rust, GPU) con Oz (orquestador cloud de agentes en background) | Terminal nativa + Active AI suggestions | Free tier · Build $20/mes (1500 créditos) · Max $200/mes · Business $50/usuario/mes | Cliente: código público, dual MIT/AGPLv3 (abr 2026). Oz (cloud) no es open source | MCP nativo (Factory MCP), agentes en background reaccionan a webhooks/CI/Slack — no tiene canvas de flujo, es terminal-first |

---

## 4. Comparación — qué tenemos, qué no, en común

### Features que tenemos nosotros y (casi) nadie más de esta lista tiene junto:
- **Un solo binario de escritorio** que combina terminal multi-sesión + chat + flow-canvas visual de equipos de agentes en la misma ventana (Grok Build y Orca son fuertes en terminal/worktrees paralelos pero no tienen canvas de flujo con nodo-supervisor guardable como "Team"; LangGraph/Flowise/CrewAI tienen canvas pero no integran una terminal real ni gestión de proyectos/chat en la misma app).
- **"Teams" guardados como flujos reutilizables** (`agentTeams.save/list`, abrir un team recarga nodos+edges en el canvas) — Orca/Conductor no tienen el concepto de "equipo" persistido y reabrible visualmente; se acercan más LangGraph Studio (grafos guardados) y CrewAI Studio (crews).
- **Canales multi-superficie nativos** (Telegram, Discord, Slack, TUI, HTTP) desde el mismo kernel de plugins — ninguno de los competidores listados expone esto; son todos "solo escritorio" o "solo cloud/web".
- **Integración Google (Gmail/Calendar/Drive) como tool nativo** vía OAuth iniciado desde el teléfono — no encontrado en ninguno de estos competidores como feature de primera clase.
- **Delegación a CLI headless persistente** (`tool-cli-delegate`, delega a `claude`/`agy` con sesión persistente) — concepto similar a lo que Orca hace con "cualquier agente CLI", pero nosotros lo exponemos como tool interno, no como el producto entero.

### Features que ellos tienen y nosotros no:
- **Aislamiento por git worktree por tarea/agente** (Orca, Conductor, Grok Build) — nuestro Agent Flow no crea worktrees aislados automáticamente por nodo; los nodos comparten el mismo `projectPath`/cwd.
- **Diff viewer / PR flow integrado** (Conductor) — revisar cambios de cada agente lado a lado antes de mergear.
- **"Design Mode" — click en UI embebida → contexto al agente** (Orca) — puente directo entre una vista previa de browser y el prompt.
- **Compañero móvil para orquestar agentes remotos** (Orca, Warp Business) — nosotros no tenemos app móvil.
- **Modo "Arena" (competir outputs y rankearlos automáticamente)** (Grok Build) — no tenemos evaluación automática de múltiples soluciones candidatas.
- **Integraciones prearmadas de terceros (Linear, GitHub PRs/issues, Notion, Salesforce, HubSpot, Slack) navegables dentro de la app** (Orca, CrewAI Studio) — nosotros solo tenemos Google y MCP genérico.
- **MCP nativo + agentes reactivos a eventos externos (webhooks/CI/Slack)** (Warp Oz) — nuestro `tool-mcp` puentea servidores MCP como tools, pero no tenemos un orquestador cloud reactivo a eventos externos.
- **Grafo con estado explícito tipo state machine** (LangGraph) — su canvas modela transiciones de estado, más potente para flujos condicionales que nuestro supervisor→workers lineal.

### UI/UX — diferencias:
- Nosotros: **desktop nativo unificado** (terminal + chat + canvas en una ventana), estética propia con title bar frameless.
- Orca/Conductor/Grok Build: enfoque **terminal-first / worktree-first**, canvas visual ausente o mínimo; priorizan velocidad de iteración en paralelo sobre visualización de flujo.
- LangGraph Studio/Flowise/AutoGen Studio/CrewAI Studio: **canvas-first**, pero como parte de una plataforma más grande (LangSmith, AMP), no como app de escritorio standalone con terminal integrada.
- Warp: **terminal reinventada** con IA ambient, sin canvas de agentes en absoluto.

### Pricing / modelo de negocio — diferencias:
- La mayoría de competidores serios ya monetizan con **tiers SaaS** (Conductor $50-60/mes, Warp $20-200/mes, CrewAI AMP por ejecución, Flowise cloud por predicción) sobre un core gratis/open-source.
- Nosotros no tenemos pricing — es proyecto personal/privado, sin oferta comercial todavía.
- Patrón común: **"bring your own model/subscription"** (Orca, Conductor, Grok Build no cobran por el LLM) — igual que nosotros.

### Open-source — diferencias:
- **Abiertos de verdad:** Orca (MIT), AutoGen (MIT), Flowise (Apache 2.0, aunque archivado ago 2026), CrewAI framework (open), Warp cliente (MIT/AGPLv3 dual desde abr 2026), LangGraph framework (open).
- **Cerrados/comerciales:** Conductor, Warp Oz (cloud), CrewAI AMP/Studio, LangSmith/LangGraph Studio cloud.
- **Nosotros:** sin licencia publicada — de facto código cerrado/privado, aunque el repo está en GitHub.

### Patrón convergente que vale la pena notar:
Casi todos los competidores relevantes en 2026 convergen en **"un agente coordinador que reparte trabajo a sub-agentes en entornos aislados (worktree/branch), con un dashboard para supervisar en paralelo"** — el aislamiento por worktree es prácticamente universal (Grok Build, Orca, Conductor) y es la pieza que más nos falta frente a ellos. El segundo patrón convergente es **"bring your own subscription"**: ninguno de los serios revende acceso al LLM subyacente, todos cobran por la capa de orquestación/UI, no por tokens.

---

## 5. Recomendaciones (priorizadas)

1. **Aislamiento por git worktree por nodo de Agent Flow.** Es la brecha más grande frente a Grok Build/Orca/Conductor y la más citada en cada review de 2026. Cada nodo worker podría correr en su propio worktree+branch en vez de compartir `projectPath`.
2. **Diff/PR review integrado tras una ejecución de flujo** (estilo Conductor) — hoy `runFlow()` deja los cambios en el proyecto sin un panel de revisión dedicado.
3. **Explorar un modelo tipo LangGraph** (edges condicionales / estado compartido) para el Agent Flow, no solo supervisor→workers — daría al canvas más poder expresivo que el de casi todos los competidores canvas-first.
4. **Publicar una licencia** (aunque sea para uso interno) si en algún punto se planea abrir el repo o dar acceso a terceros — hoy es ambiguo legalmente.
5. **Integraciones tipo "click en contexto" (Design Mode de Orca)** — encaja bien con que ya tenemos Electron + panes; podría alimentar el prompt del agente con capturas/HTML de una vista embebida.
6. Menor prioridad: companion móvil (Orca, Warp) — alto esfuerzo, valor incierto hasta que el resto del producto esté más maduro.

---

## Fuentes

- [GitHub — stablyai/orca](https://github.com/stablyai/orca)
- [Orca Docs](https://www.onorca.dev/docs)
- [Aridane Martín — How to Orchestrate Multiple AI Agents with Orca](https://aridanemartin.dev/blog/orca-orchestrate-agents/)
- [MOGE — Orca product page](https://moge.ai/product/orca)
- [ThakeeNathees/orca (DSL, distinto proyecto)](https://github.com/ThakeeNathees/orca)
- [Grok Build review — BuildFastWithAI](https://www.buildfastwithai.com/blogs/grok-build-xai-cli-ai-agents-2026)
- [DevOps.com — xAI Enters the Coding Agent Race With Grok Build](https://devops.com/xai-enters-the-coding-agent-race-with-grok-build/)
- [TechJack — Grok Build Agent Dashboard](https://techjacksolutions.com/ai-brief/xais-grok-build-agent-dashboard-manage-eight-parallel-coding/)
- [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
- [madewithlove — Conductor by Melty Labs](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/)
- [Fixed Labs — Conductor Pricing & Alternatives](https://www.fixedlabs.ai/tools/conductor)
- [LangChain — LangGraph Studio: The first agent IDE](https://www.langchain.com/blog/langgraph-studio-the-first-agent-ide)
- [TrueFoundry — LangGraph Pricing 2026](https://www.truefoundry.com/blog/langgraph-pricing)
- [BuildFastWithAI — AutoGen Review 2026](https://www.buildfastwithai.com/ai-tools/autogen)
- [andrew.ooo — Microsoft AutoGen 2026 Complete Guide](https://andrew.ooo/tools/ai-agents/autogen/)
- [checkthat.ai — Flowise Pricing 2026](https://checkthat.ai/brands/flowise/pricing)
- [Agent Finder — Flowise Review 2026](https://agent-finder.co/reviews/flowise)
- [Toolworthy — CrewAI Review 2026](https://www.toolworthy.ai/tool/crewai)
- [TechJack — CrewAI Pricing: Open Source vs Enterprise](https://techjacksolutions.com/ai-tools/crewai/crewai-pricing/)
- [DeployHQ — Warp Guide 2026](https://www.deployhq.com/guides/warp)
- [datastudios.org — Warp Terminal: Open-Source Client, Agent Orchestration, and Oz Pricing](https://www.datastudios.org/post/warp-terminal-open-source-client-agent-orchestration-and-oz-pricing-explained)
