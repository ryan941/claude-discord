import { query } from "@anthropic-ai/claude-agent-sdk";

export interface AgentResult {
  text: string;
  sessionId: string;
  cost?: number;
  error?: boolean;
}

export interface ToolEvent {
  tool: string;     // "Read", "Edit", "Write", "Bash", etc.
  summary: string;  // human-readable one-liner
}

export interface StreamCallbacks {
  onToolUse?: (event: ToolEvent) => void;
  onThinking?: () => void;
}

// Thread → sessionId mapping
const threadSessions = new Map<string, string>();

export function getSessionId(threadId: string): string | undefined {
  return threadSessions.get(threadId);
}

export function setSessionId(threadId: string, sessionId: string): void {
  threadSessions.set(threadId, sessionId);
}

function summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "read_file":
      return `Reading \`${input.file_path || input.path || "file"}\``;
    case "Edit":
    case "edit_file":
      return `Editing \`${input.file_path || input.path || "file"}\``;
    case "Write":
    case "write_file":
      return `Writing \`${input.file_path || input.path || "file"}\``;
    case "Bash":
    case "bash": {
      const cmd = String(input.command || "").slice(0, 80);
      return `Running \`${cmd}\`${String(input.command || "").length > 80 ? "..." : ""}`;
    }
    case "Glob":
    case "glob":
      return `Searching for \`${input.pattern || "files"}\``;
    case "Grep":
    case "grep":
      return `Searching for \`${input.pattern || "pattern"}\``;
    default:
      return `Using ${toolName}`;
  }
}

export async function runAgent(
  prompt: string,
  cwd: string,
  threadId: string,
  callbacks?: StreamCallbacks
): Promise<AgentResult> {
  const sessionId = threadSessions.get(threadId);

  const stream = query({
    prompt,
    options: {
      cwd,
      resume: sessionId,
      permissionMode: "bypassPermissions",
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project"],
    },
  });

  let resultText = "";
  let newSessionId = sessionId ?? "";
  let cost: number | undefined;

  for await (const message of stream) {
    if (message.type === "system" && message.subtype === "init") {
      newSessionId = message.session_id;
    }

    // Emit tool use events for progress feedback
    if (message.type === "assistant" && "content" in message) {
      const content = message.content as Array<Record<string, unknown>>;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use") {
            const toolName = String(block.name || "unknown");
            const input = (block.input || {}) as Record<string, unknown>;
            callbacks?.onToolUse?.({
              tool: toolName,
              summary: summarizeToolUse(toolName, input),
            });
          }
          if (block.type === "thinking") {
            callbacks?.onThinking?.();
          }
        }
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
        cost = message.total_cost_usd;
      } else {
        resultText = `Error: ${message.subtype}`;
        if ("errors" in message && Array.isArray(message.errors)) {
          resultText += `\n${message.errors.join("\n")}`;
        }
        threadSessions.set(threadId, newSessionId);
        return { text: resultText, sessionId: newSessionId, error: true };
      }
    }
  }

  threadSessions.set(threadId, newSessionId);
  return { text: resultText, sessionId: newSessionId, cost };
}
