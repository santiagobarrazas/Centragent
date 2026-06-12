export type RunInvocation = {
  prompt: string;
  mcpConfigPath: string;
  allowedTools: string[];
  maxTurns: number;
  resumeSessionId?: string | null | undefined;
  cwd: string;
  signal: AbortSignal;
};

export type TurnUsage = {
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  costUsd?: number | undefined;
  model?: string | undefined;
};

export type RunResult = {
  sessionId?: string | null | undefined;
  costUsd?: number | undefined;
  turns?: number | undefined;
  isError: boolean;
  text?: string | undefined;
};

export type McpConfig = { path: string; cleanup: () => void };

/** One coding-agent tool, invoked headlessly to react as the agent. */
export interface AgentToolAdapter {
  readonly provider: string;
  // Write a run-scoped MCP config carrying the agent's token (or a no-op for
  // tools that read MCP only from on-disk global config, like Codex).
  buildMcpConfig(token: string, mcpUrl: string): McpConfig;
  spawn(invocation: RunInvocation, onUsage: (usage: TurnUsage) => void): Promise<RunResult>;
}
