// Ad hoc RPC/event payload types, same convention as app-desktop's types.ts
// (no shared type-safe RPC registry — see @yggdrasil/client-web's README).

export type ChatSendResult = {
  sessionKey: string;
  reply: string;
  harnessId: string;
};

export type ChatDeltaPayload = { sessionKey: string; text: string };

export type ChatFinalPayload = {
  sessionKey: string;
  text: string;
  harnessId: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type TurnEndPayload = { sessionKey: string; classification: "ok" | "error" | "retry" | "fallback"; durationMs: number };

export type ToolExecutePayload = {
  sessionKey: string;
  toolName: string;
  status: "running" | "ok" | "error";
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
};

export type ToolApprovalRequestedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
};

export type ToolApprovalResolvedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  approved: boolean;
};

export type AgentInfo = {
  id: string;
  label?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
};

export type ProviderModelInfo = { id: string; label: string; provider: string; contextWindow?: number };

export type ProviderInfo = { id: string; label: string; models: ProviderModelInfo[]; error?: string };

export type ConfigAgent = { id: string; label?: string; provider?: string; model?: string; systemPrompt?: string };

export type ConfigProvider = { baseUrl?: string; apiKey?: string; defaultModel?: string };

// env/headers are intentionally absent here — sanitizeConfigForClient strips
// them from every config.get response, so this shape only ever carries the
// non-secret fields. Secrets are edited write-only via McpSection's
// mcpSecretEdits, mirroring apiKeyEdits.
export type ConfigMcpServer =
  | { transport: "stdio"; command?: string; args?: string[] }
  | { transport: "http"; url?: string };

export type McpServerStatus = {
  id: string;
  connected: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
};

export type ConfigShape = {
  agents?: ConfigAgent[];
  defaultAgent?: string;
  providers?: Record<string, ConfigProvider>;
  mcpServers?: Record<string, ConfigMcpServer>;
};

export type ConfigGetResult = { config: ConfigShape; workspaceRoot: string | null; configPath: string | null };

export type ConfigPatchResult = { ok: true; path: string; requiresRestart: boolean; config: ConfigShape };

// Main-process whisper concepts (packages/app-avatar/src/main/whisper.ts,
// whisperSettings.ts) — mirrored here structurally, same convention as
// app-desktop's ProjectRecord/PaneNode (main and renderer keep separate
// copies rather than importing across the Electron process boundary).
export type WhisperModelName = "tiny.en" | "tiny" | "base.en" | "base" | "small.en" | "small" | "medium.en" | "medium";

export type WhisperBackend = "cpu" | "gpu";

export type WhisperSettings = {
  binaryPath: string;
  modelsDir: string;
  model: string;
  language: string;
  backend: WhisperBackend;
};

// Mirrors main/whisperSettings.ts's STT cloud dispatcher.
export type SttCloudProvider = "groq" | "openai" | "custom" | "replicate" | "replicate-whisper" | "agy";

export type SttCloudSettings = {
  provider: SttCloudProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type SttSource = "local" | "cloud";

export type SttSettings = {
  source: SttSource;
  cloud: SttCloudSettings;
};

// Main-process piper concepts (packages/app-avatar/src/main/piper.ts,
// piperSettings.ts) — mirrored here structurally, same convention as above.
export type PiperVoiceInfo = { id: string; label: string; hfPath: string };

export type PiperSettings = {
  binaryPath: string;
  voicesDir: string;
  voice: string;
  enabled: boolean;
};

// Mirrors main/piperSettings.ts's TTS cloud dispatcher.
export type TtsCloudProvider = "minimax" | "groq" | "custom" | "replicate";

export type TtsCloudSettings = {
  provider: TtsCloudProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceId: string;
};

export type TtsSource = "local" | "cloud";

export type TtsSettings = {
  source: TtsSource;
  cloud: TtsCloudSettings;
};

export type TtsCloudResult = { audio: ArrayBuffer; mimeType: string };
