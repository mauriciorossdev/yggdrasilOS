import type {
  AgentInfo,
  ChatDeltaPayload,
  ChatFinalPayload,
  ProviderInfo,
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  ToolExecutePayload,
  TurnEndPayload,
} from "../types.js";
import { fallbackReplyText } from "./fallbackReply.js";

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

export type ChatState = {
  sessionKey: string | null;
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isTurnActive: boolean;

  agents: AgentInfo[];
  activeAgentId: string | null;
  defaultAgent: string | null;

  providers: ProviderInfo[];

  pendingApproval: PendingApproval | null;
  runningTools: string[];
};

export function initialChatState(): ChatState {
  return {
    sessionKey: null,
    messages: [],
    streamingText: "",
    isStreaming: false,
    isTurnActive: false,
    agents: [],
    activeAgentId: null,
    defaultAgent: null,
    providers: [],
    pendingApproval: null,
    runningTools: [],
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
  | { type: "SET_PROVIDERS"; providers: ProviderInfo[] };

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
          {
            id: nextMessageId(),
            role: "assistant",
            text: fallbackReplyText(action.payload.text, state.messages),
            timestamp: Date.now(),
          },
        ],
        streamingText: "",
        isStreaming: false,
      };

    case "TURN_START":
      return { ...state, isTurnActive: true };

    case "TURN_END":
      return { ...state, isTurnActive: false };

    case "TOOL_EXECUTE": {
      const { toolName, status } = action.payload;
      if (status === "running") {
        return { ...state, runningTools: [...state.runningTools, toolName] };
      }
      return {
        ...state,
        runningTools: state.runningTools.filter((n) => n !== toolName),
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: "tool",
            text: action.payload.result ?? action.payload.error ?? "",
            timestamp: Date.now(),
            toolName,
            toolStatus: status,
            toolArgs: action.payload.args,
          },
        ],
      };
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

    case "TOOL_APPROVAL_RESOLVED": {
      // The gateway can also resolve this on its own after a timeout
      // (default-deny) — without a message here, a timed-out approval just
      // silently vanishes with no indication anything happened.
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

    case "SET_PROVIDERS":
      return { ...state, providers: action.providers };

    default:
      return state;
  }
}
