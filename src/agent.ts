import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionHandler } from "./platforms/types";

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
  onToolResult?: (toolName: string, success: boolean) => void;
  onThinking?: () => void;
  onText?: (text: string) => void;
}

// Thread → sessionId mapping
const threadSessions = new Map<string, string>();

export function getSessionId(threadId: string): string | undefined {
  return threadSessions.get(threadId);
}

export function setSessionId(threadId: string, sessionId: string): void {
  threadSessions.set(threadId, sessionId);
}

// Track last tool name for correlating with tool_result
let lastToolName = "";

export function summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "read_file": {
      const path = String(input.file_path || input.path || "file");
      const shortPath = path.split("/").slice(-2).join("/");
      return `Reading \`${shortPath}\``;
    }
    case "Edit":
    case "edit_file": {
      const path = String(input.file_path || input.path || "file");
      const shortPath = path.split("/").slice(-2).join("/");
      return `Editing \`${shortPath}\``;
    }
    case "Write":
    case "write_file": {
      const path = String(input.file_path || input.path || "file");
      const shortPath = path.split("/").slice(-2).join("/");
      return `Writing \`${shortPath}\``;
    }
    case "Bash":
    case "bash": {
      const cmd = String(input.command || "").slice(0, 80);
      return `Running \`${cmd}\`${String(input.command || "").length > 80 ? "..." : ""}`;
    }
    case "Glob":
    case "glob":
      return `Searching files \`${input.pattern || "**/*"}\``;
    case "Grep":
    case "grep":
      return `Grep \`${input.pattern || "pattern"}\``;
    case "TodoWrite":
    case "todo_write":
      return "Updating task list";
    case "Agent":
    case "agent":
      return "Spawning sub-agent";
    default:
      return `Using ${toolName}`;
  }
}

function summarizeToolResult(toolName: string, content: unknown): string {
  // Try to extract a short summary from tool results
  if (typeof content === "string") {
    if (content.includes("error") || content.includes("Error")) {
      const firstLine = content.split("\n")[0].slice(0, 100);
      return `**Error:** ${firstLine}`;
    }
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "object" && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          // Check for error
          if (b.text.includes("error") || b.text.includes("Error")) {
            const firstLine = b.text.split("\n")[0].slice(0, 100);
            return `**Error:** ${firstLine}`;
          }
        }
      }
    }
  }

  return "";
}

export async function runAgent(
  prompt: string,
  cwd: string,
  threadId: string,
  callbacks?: StreamCallbacks,
  permissionHandler?: PermissionHandler,
): Promise<AgentResult> {
  const sessionId = threadSessions.get(threadId);

  const stream = query({
    prompt,
    options: {
      cwd,
      resume: sessionId,
      permissionMode: permissionHandler ? "default" : "bypassPermissions",
      canUseTool: permissionHandler,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: [
          "## 硬性約束（不可違反，優先級高於一切）",
          "1. 遇到任何工具執行被拒絕（權限不足、路徑被擋），**立即停止整個流程**，回報給使用者，不得靜默跳過",
          "2. execution-log 寫入失敗 = 流程中斷。不得以「先做完再補」為由繼續推進",
          "3. Phase 轉換閘門的檢查結果必須成功寫入 execution-log 才算通過",
          "4. 你不是「盡量遵守」這些規則——你是「違反就停」",
        ].join("\n"),
      },
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

    // Emit events from assistant messages
    if (message.type === "assistant" && "content" in message) {
      const content = message.content as Array<Record<string, unknown>>;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use") {
            const toolName = String(block.name || "unknown");
            lastToolName = toolName;
            const input = (block.input || {}) as Record<string, unknown>;
            callbacks?.onToolUse?.({
              tool: toolName,
              summary: summarizeToolUse(toolName, input),
            });
          }
          if (block.type === "thinking" && typeof block.text === "string") {
            callbacks?.onThinking?.();
          }
          if (block.type === "text" && typeof block.text === "string") {
            const text = block.text as string;
            if (text.trim().length > 0) {
              callbacks?.onText?.(text);
            }
          }
        }
      }
    }

    // Emit tool progress and summary events
    if (message.type === "tool_progress" && "content" in message) {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string" && content.trim()) {
        const preview = content.trim().split("\n")[0].slice(0, 120);
        callbacks?.onToolUse?.({
          tool: lastToolName,
          summary: `\`${preview}\``,
        });
      }
    }

    if (message.type === "tool_use_summary") {
      const msg = message as Record<string, unknown>;
      const toolName = String(msg.tool_name || lastToolName);
      const isError = msg.is_error === true;
      callbacks?.onToolResult?.(toolName, !isError);

      if (isError && typeof msg.error === "string") {
        callbacks?.onToolUse?.({
          tool: toolName,
          summary: `**Error:** ${msg.error.slice(0, 100)}`,
        });
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
