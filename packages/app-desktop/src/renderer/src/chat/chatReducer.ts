import type {
  AgentInfo,
  ApprovalMode,
  ChatDeltaPayload,
  ChatFinalPayload,
  ProviderInfo,
  SessionInfo,
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  ToolExecutePayload,
  TurnEndPayload,
} from "../types.js";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
  toolName?: string;
  toolStatus?: "running" | "ok" | "error";
  toolArgs?: Record<string, unknown>;
  toolImage?: { base64: string; mimeType: string; path?: string };
};

export type PendingApproval = {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
  deviceId?: string;
};

export type ModelOverride = { provider: string; model: string };

export type ChatState = {
  sessionKey: string | null;
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isTurnActive: boolean;
  turnDurationMs: number | null;

  agents: AgentInfo[];
  activeAgentId: string | null;
  defaultAgent: string | null;

  providers: ProviderInfo[];
  modelOverride: ModelOverride | null;

  sessions: SessionInfo[];

  pendingApproval: PendingApproval | null;
  toolCalls: Map<string, ToolExecutePayload>;
  lastUsage: { inputTokens?: number; outputTokens?: number } | null;

  mode: ApprovalMode;
};

export function initialChatState(): ChatState {
  return {
    sessionKey: null,
    messages: [],
    streamingText: "",
    isStreaming: false,
    isTurnActive: false,
    turnDurationMs: null,
    agents: [],
    activeAgentId: null,
    defaultAgent: null,
    providers: [],
    modelOverride: null,
    sessions: [],
    pendingApproval: null,
    toolCalls: new Map(),
    lastUsage: null,
    mode: "auto",
  };
}

export type ChatAction =
  | { type: "SET_SESSION_KEY"; sessionKey: string }
  | { type: "ADD_USER_MESSAGE"; text: string }
  | { type: "ADD_SYSTEM_MESSAGE"; text: string }
  | { type: "CHAT_DELTA"; payload: ChatDeltaPayload }
  | { type: "CHAT_FINAL"; payload: ChatFinalPayload }
  | { type: "TURN_START" }
  | { type: "TURN_END"; payload: TurnEndPayload }
  | { type: "TOOL_EXECUTE"; payload: ToolExecutePayload }
  | { type: "TOOL_APPROVAL_REQUESTED"; payload: ToolApprovalRequestedPayload }
  | { type: "TOOL_APPROVAL_RESOLVED"; payload: ToolApprovalResolvedPayload }
  | { type: "SET_AGENTS"; agents: AgentInfo[]; defaultAgent: string }
  | { type: "SET_ACTIVE_AGENT"; agentId: string }
  | { type: "SET_PROVIDERS"; providers: ProviderInfo[] }
  | { type: "SET_MODEL_OVERRIDE"; override: ModelOverride | null }
  | { type: "SET_SESSIONS"; sessions: SessionInfo[] }
  | { type: "RESET_MESSAGES" }
  | { type: "LOAD_SESSION"; sessionKey: string; messages: ChatMessage[] }
  | { type: "SET_MODE"; mode: ApprovalMode };

let messageCounter = 0;
function nextMessageId(): string {
  return `msg-${++messageCounter}`;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSION_KEY":
      return { ...state, sessionKey: action.sessionKey };

    case "ADD_USER_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, { id: nextMessageId(), role: "user", text: action.text, timestamp: Date.now() }],
      };

    case "ADD_SYSTEM_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, { id: nextMessageId(), role: "system", text: action.text, timestamp: Date.now() }],
      };

    case "CHAT_DELTA":
      return { ...state, streamingText: state.streamingText + action.payload.text, isStreaming: true };

    case "CHAT_FINAL":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: nextMessageId(), role: "assistant", text: action.payload.text, timestamp: Date.now() },
        ],
        streamingText: "",
        isStreaming: false,
        lastUsage: action.payload.usage ?? state.lastUsage,
      };

    case "TURN_START":
      return { ...state, isTurnActive: true, turnDurationMs: null };

    case "TURN_END":
      return { ...state, isTurnActive: false, turnDurationMs: action.payload.durationMs };

    case "TOOL_EXECUTE": {
      const toolCalls = new Map(state.toolCalls);
      const key = `${action.payload.toolName}-${Date.now()}`;
      toolCalls.set(key, action.payload);

      if (action.payload.status === "ok" || action.payload.status === "error") {
        return {
          ...state,
          toolCalls,
          messages: [
            ...state.messages,
            {
              id: nextMessageId(),
              role: "tool",
              text: action.payload.result ?? action.payload.error ?? "",
              timestamp: Date.now(),
              toolName: action.payload.toolName,
              toolStatus: action.payload.status,
              toolArgs: action.payload.args,
              toolImage: action.payload.image,
            },
          ],
        };
      }
      return { ...state, toolCalls };
    }

    case "TOOL_APPROVAL_REQUESTED":
      return {
        ...state,
        pendingApproval: {
          requestId: action.payload.requestId,
          toolName: action.payload.toolName,
          args: action.payload.args,
          riskLevel: action.payload.riskLevel,
          deviceId: action.payload.deviceId,
        },
      };

    case "TOOL_APPROVAL_RESOLVED": {
      // The gateway resolves this on its own after a timeout (see
      // APPROVAL_TIMEOUT_MS in gateway/methods.ts) as well as on an explicit
      // click — without a message here, a timed-out approval just silently
      // vanishes with no indication anything happened.
      const label = action.payload.approved ? "Approved" : "Denied";
      return {
        ...state,
        pendingApproval: null,
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: "system",
            text: `${label}: ${action.payload.toolName}`,
            timestamp: Date.now(),
          },
        ],
      };
    }

    case "SET_AGENTS":
      return {
        ...state,
        agents: action.agents,
        defaultAgent: action.defaultAgent,
        activeAgentId: state.activeAgentId ?? action.defaultAgent,
      };

    case "SET_ACTIVE_AGENT":
      // Switching agents clears any model override — the picker falls back
      // to showing (and using) the newly-selected agent's own model.
      return { ...state, activeAgentId: action.agentId, modelOverride: null };

    case "SET_PROVIDERS":
      return { ...state, providers: action.providers };

    case "SET_MODEL_OVERRIDE":
      return { ...state, modelOverride: action.override };

    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };

    case "RESET_MESSAGES":
      return { ...state, messages: [], streamingText: "", isStreaming: false };

    case "LOAD_SESSION":
      return {
        ...state,
        sessionKey: action.sessionKey,
        messages: action.messages,
        streamingText: "",
        isStreaming: false,
      };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    default:
      return state;
  }
}
