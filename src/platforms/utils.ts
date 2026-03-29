import { ChatChannel, ReplyHandler, VerbosityMode } from "./types";
import { runAgent, StreamCallbacks } from "../agent";
import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

// --- Message splitting ---

export function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0) splitAt = limit;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }

  return chunks;
}

// --- Progress sender ---

export function createProgressSender(
  channel: ChatChannel,
  msgLimit: number,
  verbosity: VerbosityMode = "normal",
) {
  // quiet mode: all operations are noop
  if (verbosity === "quiet") {
    return {
      pushTool(_tool: string, _summary: string) {},
      push(_line: string) {},
      async finish() {},
    };
  }

  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  let pendingTool = "";
  let pendingLabel = "";
  let pendingFiles: string[] = [];

  // normal mode: track progress message ID for edit-in-place
  let progressMessageId: string | undefined;
  let isEditing = false;

  const flushPending = () => {
    if (pendingFiles.length === 0) return;
    if (pendingFiles.length === 1) {
      queue.push(`> ${pendingLabel} \`${pendingFiles[0]}\``);
    } else {
      const fileList = pendingFiles.map((f) => `>   \`${f}\``).join("\n");
      queue.push(`> ${pendingLabel} ${pendingFiles.length} files...\n${fileList}`);
    }
    pendingTool = "";
    pendingLabel = "";
    pendingFiles = [];
  };

  const flush = async () => {
    flushPending();
    if (queue.length === 0) return;
    const lines = queue.splice(0);
    const text = lines.join("\n").slice(0, msgLimit);

    try {
      if (verbosity === "normal" && progressMessageId) {
        // normal mode: edit the existing progress message in place
        if (isEditing) return;
        isEditing = true;
        try {
          await channel.edit(progressMessageId, text);
        } catch {
          // edit failed (message deleted, etc.) — fallback to send
          progressMessageId = await channel.send(text);
        }
        isEditing = false;
      } else {
        // verbose mode: always send new message
        // normal mode first flush: send and cache message ID
        const msgId = await channel.send(text);
        if (verbosity === "normal" && !progressMessageId) {
          progressMessageId = msgId;
        }
      }
    } catch {}
  };

  return {
    pushTool(tool: string, summary: string) {
      const mergeableTools: Record<string, string> = {
        Read: "Reading",
        read_file: "Reading",
        Edit: "Editing",
        edit_file: "Editing",
        Write: "Writing",
        write_file: "Writing",
      };

      const label = mergeableTools[tool];
      if (label) {
        const match = summary.match(/`([^`]+)`/);
        const fileName = match ? match[1] : tool;

        if (pendingTool === tool) {
          pendingFiles.push(fileName);
        } else {
          flushPending();
          pendingTool = tool;
          pendingLabel = label;
          pendingFiles = [fileName];
        }
      } else {
        flushPending();
        queue.push(`> ${summary}`);
      }

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { flush(); }, 1500);
    },
    push(line: string) {
      flushPending();
      queue.push(line);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { flush(); }, 1500);
    },
    async finish() {
      if (timer) clearTimeout(timer);
      await flush();
    },
  };
}

// --- Agent run handler ---

export async function handleAgentRun(
  channel: ChatChannel,
  prompt: string,
  cwd: string,
  threadId: string,
  reply: ReplyHandler,
  msgLimit: number,
  verbosity: VerbosityMode = "normal",
  userMessageId?: string,
): Promise<void> {
  channel.sendTyping();

  // Emoji reaction: processing started
  if (userMessageId) {
    channel.react(userMessageId, "⏳").catch(() => {});
  }

  const progress = createProgressSender(channel, msgLimit, verbosity);

  let thinkingNotified = false;
  let textBuffer = "";
  let textTimer: ReturnType<typeof setTimeout> | null = null;

  const flushText = async () => {
    if (textBuffer.trim().length === 0) return;
    const text = textBuffer.trim();
    textBuffer = "";
    const truncated = text.length > msgLimit - 200
      ? text.slice(0, msgLimit - 200) + "\n..."
      : text;
    try {
      await channel.send(truncated);
    } catch {}
  };

  const callbacks: StreamCallbacks = {
    onToolUse(event) {
      if (textTimer) { clearTimeout(textTimer); textTimer = null; }
      if (textBuffer.trim()) {
        flushText();
      }
      progress.pushTool(event.tool, event.summary);
    },
    onToolResult(toolName, success) {
      if (!success) {
        progress.push(`> ${toolName} failed`);
      }
    },
    onThinking() {
      if (!thinkingNotified) {
        thinkingNotified = true;
        progress.push("> Thinking...");
      }
    },
    onText(text) {
      thinkingNotified = false;
      textBuffer += text;
      if (textTimer) clearTimeout(textTimer);
      textTimer = setTimeout(() => { flushText(); }, 3000);
    },
  };

  try {
    const result = await runAgent(prompt, cwd, threadId, callbacks);

    if (textTimer) clearTimeout(textTimer);
    await flushText();
    await progress.finish();

    const costInfo = result.cost != null ? `\n-# Cost: $${result.cost.toFixed(4)}` : "";
    const resultText = (result.text || "(no response)") + costInfo;
    const chunks = splitMessage(resultText, msgLimit);

    for (let i = 0; i < chunks.length; i++) {
      await reply.sendResult(chunks[i], i === 0);
    }

    // Emoji reaction: success
    if (userMessageId) {
      channel.removeReact(userMessageId, "⏳").catch(() => {});
      channel.react(userMessageId, "✅").catch(() => {});
    }
  } catch (err) {
    if (textTimer) clearTimeout(textTimer);
    await progress.finish();
    const errorMsg = err instanceof Error ? err.message : String(err);
    await reply.sendError(errorMsg);

    // Emoji reaction: failure
    if (userMessageId) {
      channel.removeReact(userMessageId, "⏳").catch(() => {});
      channel.react(userMessageId, "❌").catch(() => {});
    }
  }
}

// --- Shared watcher utilities ---

export const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "__pycache__",
  ".venv",
  "venv",
]);

export interface ProjectInfo {
  name: string;
  mtime: number;
}

export function listProjectDirs(watchDir: string): ProjectInfo[] {
  if (!existsSync(watchDir)) return [];
  return readdirSync(watchDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !IGNORE_DIRS.has(d.name))
    .map((d) => {
      const fullPath = join(watchDir, d.name);
      const stat = statSync(fullPath);
      return { name: d.name, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function projectToChannelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 80);
}
