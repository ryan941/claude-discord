import { query } from "@anthropic-ai/claude-agent-sdk";

export interface AgentResult {
  text: string;
  sessionId: string;
  cost?: number;
  error?: boolean;
}

// Thread → sessionId mapping
const threadSessions = new Map<string, string>();

export function getSessionId(threadId: string): string | undefined {
  return threadSessions.get(threadId);
}

export function setSessionId(threadId: string, sessionId: string): void {
  threadSessions.set(threadId, sessionId);
}

export async function runAgent(
  prompt: string,
  cwd: string,
  threadId: string
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
