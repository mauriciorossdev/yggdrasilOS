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
  TurnStartPayload,
} from "../client/types.js";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
  toolName?: string;
  toolStatus?: "running" | "ok" | "error";
  toolArgs?: Record<string, unknown>;
};

export type PendingApproval = {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
};

export type ViewMode = "chat" | "config" | "sessions" | "agents" | "command-palette";

export type TuiState = {
  connected: boolean;
  connectionError: string | null;
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
  sessions: SessionInfo[];

  pendingApproval: PendingApproval | null;
  toolCalls: Map<string, ToolExecutePayload>;
  lastUsage: { inputTokens?: number; outputTokens?: number } | null;

  viewMode: ViewMode;
  viewStack: ViewMode[];
  scrollOffset: number;
  inputHistory: string[];
  historyIndex: number;

  config: Record<string, unknown> | null;
  configPath: string | null;

  mode: ApprovalMode;
};

export function initialState(): TuiState {
  return {
    connected: false,
    connectionError: null,
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
    sessions: [],
    pendingApproval: null,
    toolCalls: new Map(),
    lastUsage: null,
    viewMode: "chat",
    viewStack: [],
    scrollOffset: 0,
    inputHistory: [],
    historyIndex: -1,
    config: null,
    configPath: null,
    mode: "auto",
  };
}

export type TuiAction =
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_CONNECTION_ERROR"; error: string }
  | { type: "SET_SESSION_KEY"; sessionKey: string }
  | { type: "ADD_USER_MESSAGE"; text: string }
  | { type: "ADD_SYSTEM_MESSAGE"; text: string }
  | { type: "CHAT_DELTA"; payload: ChatDeltaPayload }
  | { type: "CHAT_FINAL"; payload: ChatFinalPayload }
  | { type: "TURN_START"; payload: TurnStartPayload }
  | { type: "TURN_END"; payload: TurnEndPayload }
  | { type: "TOOL_EXECUTE"; payload: ToolExecutePayload }
  | { type: "TOOL_APPROVAL_REQUESTED"; payload: ToolApprovalRequestedPayload }
  | { type: "TOOL_APPROVAL_RESOLVED"; payload: ToolApprovalResolvedPayload }
  | { type: "SET_AGENTS"; agents: AgentInfo[]; defaultAgent: string }
  | { type: "SET_ACTIVE_AGENT"; agentId: string }
  | { type: "SET_PROVIDERS"; providers: ProviderInfo[] }
  | { type: "SET_SESSIONS"; sessions: SessionInfo[] }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "PUSH_VIEW"; mode: ViewMode }
  | { type: "POP_VIEW" }
  | { type: "SCROLL"; delta: number }
  | { type: "RESET_MESSAGES" }
  | { type: "PUSH_INPUT_HISTORY"; text: string }
  | { type: "SET_HISTORY_INDEX"; index: number }
  | { type: "SET_CONFIG"; config: Record<string, unknown>; configPath: string | null }
  | { type: "LOAD_SESSION"; sessionKey: string; messages: ChatMessage[] }
  | { type: "SET_MODE"; mode: ApprovalMode };

let messageCounter = 0;
function nextMessageId(): string {
  return `msg-${++messageCounter}`;
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: action.connected, connectionError: null };

    case "SET_CONNECTION_ERROR":
      return { ...state, connected: false, connectionError: action.error };

    case "SET_SESSION_KEY":
      return { ...state, sessionKey: action.sessionKey };

    case "ADD_USER_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: "user",
            text: action.text,
            timestamp: Date.now(),
          },
        ],
        scrollOffset: 0,
      };

    case "ADD_SYSTEM_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: "system",
            text: action.text,
            timestamp: Date.now(),
          },
        ],
        scrollOffset: 0,
      };

    case "CHAT_DELTA":
      return {
        ...state,
        streamingText: state.streamingText + action.payload.text,
        isStreaming: true,
      };

    case "CHAT_FINAL":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: "assistant",
            text: action.payload.text,
            timestamp: Date.now(),
          },
        ],
        streamingText: "",
        isStreaming: false,
        scrollOffset: 0,
        lastUsage: action.payload.usage ?? state.lastUsage,
      };

    case "TURN_START":
      return { ...state, isTurnActive: true, turnDurationMs: null };

    case "TURN_END":
      return {
        ...state,
        isTurnActive: false,
        turnDurationMs: action.payload.durationMs,
      };

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
            },
          ],
          scrollOffset: 0,
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
        },
      };

    case "TOOL_APPROVAL_RESOLVED":
      return { ...state, pendingApproval: null };

    case "SET_AGENTS":
      return {
        ...state,
        agents: action.agents,
        defaultAgent: action.defaultAgent,
        activeAgentId: state.activeAgentId ?? action.defaultAgent,
      };

    case "SET_ACTIVE_AGENT":
      return { ...state, activeAgentId: action.agentId };

    case "SET_PROVIDERS":
      return { ...state, providers: action.providers };

    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };

    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };

    case "PUSH_VIEW": {
      if (action.mode === state.viewMode) return state;
      return {
        ...state,
        viewStack: [...state.viewStack, state.viewMode],
        viewMode: action.mode,
      };
    }

    case "POP_VIEW": {
      if (state.viewStack.length === 0) {
        return { ...state, viewMode: "chat" };
      }
      const nextStack = state.viewStack.slice(0, -1);
      const prevMode = state.viewStack[state.viewStack.length - 1]!;
      return { ...state, viewStack: nextStack, viewMode: prevMode };
    }

    case "SCROLL":
      return {
        ...state,
        scrollOffset: Math.max(0, state.scrollOffset + action.delta),
      };

    case "RESET_MESSAGES":
      return {
        ...state,
        messages: [],
        streamingText: "",
        isStreaming: false,
        scrollOffset: 0,
      };

    case "PUSH_INPUT_HISTORY":
      return {
        ...state,
        inputHistory: [...state.inputHistory, action.text],
        historyIndex: -1,
      };

    case "SET_HISTORY_INDEX":
      return { ...state, historyIndex: action.index };

    case "SET_CONFIG":
      return {
        ...state,
        config: action.config,
        configPath: action.configPath,
      };

    case "LOAD_SESSION":
      return {
        ...state,
        sessionKey: action.sessionKey,
        messages: action.messages,
        streamingText: "",
        isStreaming: false,
        scrollOffset: 0,
        viewMode: "chat",
        viewStack: [],
      };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    default:
      return state;
  }
}
