export type ContextProviderContext = {
  sessionKey: string;
  agentId: string;
  workspaceRoot: string;
  config: unknown;
  globalConfig: unknown;
  metadata?: Record<string, unknown>;
};

export type ContextBlock = {
  role: "system";
  content: string;
  source: string;
  priority: number;
  tokens?: number;
  cacheable?: boolean;
  ttlMs?: number;
};

export type ContextProvider = {
  id: string;
  label?: string;
  priority?: number;
  supports?(ctx: ContextProviderContext): boolean | Promise<boolean>;
  assemble(ctx: ContextProviderContext): Promise<ContextBlock[]>;
};

export type ContextProviderRegistration = ContextProvider;
