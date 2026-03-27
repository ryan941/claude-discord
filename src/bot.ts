import {
  Client,
  GatewayIntentBits,
  Message,
  MessageType,
  Partials,
  TextChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { BotConfig } from "./config";
import { runAgent, StreamCallbacks } from "./agent";
import { resolveSkill, buildSkillPrompt, listSkills, preloadSkills, isSkillCommand } from "./skills";

const DISCORD_MSG_LIMIT = 2000;

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MSG_LIMIT) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MSG_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline before the limit
    let splitAt = remaining.lastIndexOf("\n", DISCORD_MSG_LIMIT);
    if (splitAt <= 0) splitAt = DISCORD_MSG_LIMIT;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }

  return chunks;
}

function resolveProjectCwd(
  channelId: string,
  config: BotConfig
): string | null {
  return config.channelProjects.get(channelId) ?? null;
}

// Keep typing indicator alive until the returned stop function is called
function keepTyping(channel: TextChannel | ThreadChannel): () => void {
  let alive = true;

  const tick = () => {
    if (!alive) return;
    channel.sendTyping().catch(() => {});
    setTimeout(tick, 8000); // Discord typing lasts ~10s, refresh every 8s
  };
  tick();

  return () => { alive = false; };
}

// Debounced progress sender — batches and merges consecutive same-type tool events
function createProgressSender(channel: TextChannel | ThreadChannel) {
  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Track consecutive same-tool calls for merging
  let pendingTool = "";       // e.g. "Read"
  let pendingLabel = "";      // e.g. "Reading"
  let pendingFiles: string[] = [];

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
    const text = lines.join("\n").slice(0, DISCORD_MSG_LIMIT);
    try {
      await channel.send(text);
    } catch {}
  };

  return {
    pushTool(tool: string, summary: string) {
      // Detect file-based tools that can be merged
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
        // Extract filename from summary like "Reading `src/bot.ts`"
        const match = summary.match(/`([^`]+)`/);
        const fileName = match ? match[1] : tool;

        if (pendingTool === tool) {
          // Same tool type — accumulate
          pendingFiles.push(fileName);
        } else {
          // Different tool — flush previous, start new group
          flushPending();
          pendingTool = tool;
          pendingLabel = label;
          pendingFiles = [fileName];
        }
      } else {
        // Non-mergeable tool — flush pending, add directly
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

async function handleAgentRun(
  channel: TextChannel | ThreadChannel,
  prompt: string,
  cwd: string,
  threadId: string,
  isReply: boolean,
  replyTarget?: Message
): Promise<void> {
  const stopTyping = keepTyping(channel);
  const progress = createProgressSender(channel);

  let thinkingNotified = false;
  let textBuffer = "";
  let textTimer: ReturnType<typeof setTimeout> | null = null;

  // Flush accumulated assistant text as a message
  const flushText = async () => {
    if (textBuffer.trim().length === 0) return;
    const text = textBuffer.trim();
    textBuffer = "";
    // Send intermediate text as a quote block to distinguish from final result
    const truncated = text.length > 1800 ? text.slice(0, 1800) + "\n..." : text;
    try {
      await channel.send(truncated);
    } catch {}
  };

  const callbacks: StreamCallbacks = {
    onToolUse(event) {
      // Flush any pending text before showing tool use
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
      thinkingNotified = false; // reset after thinking
      textBuffer += text;
      // Debounce: flush text after 3s of no new text
      if (textTimer) clearTimeout(textTimer);
      textTimer = setTimeout(() => { flushText(); }, 3000);
    },
  };

  try {
    const result = await runAgent(prompt, cwd, threadId, callbacks);

    // Flush any remaining buffers
    if (textTimer) clearTimeout(textTimer);
    await flushText();
    await progress.finish();
    stopTyping();

    // Send final result
    const costInfo = result.cost != null ? `\n-# Cost: $${result.cost.toFixed(4)}` : "";
    const resultText = (result.text || "(no response)") + costInfo;
    const chunks = splitMessage(resultText);

    for (const chunk of chunks) {
      if (isReply && replyTarget) {
        await replyTarget.reply(chunk);
        replyTarget = undefined; // only reply to the first chunk
      } else {
        await channel.send(chunk);
      }
    }
  } catch (err) {
    if (textTimer) clearTimeout(textTimer);
    stopTyping();
    await progress.finish();
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (isReply && replyTarget) {
      await replyTarget.reply(`Agent error: ${errorMsg}`);
    } else {
      await channel.send(`Agent error: ${errorMsg}`);
    }
  }
}

export function createBot(config: BotConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once("clientReady", (c) => {
    console.log(`Bot online: ${c.user.tag}`);
    console.log(
      `Mapped channels: ${[...config.channelProjects.entries()].map(([id, path]) => `${id} → ${path}`).join(", ")}`
    );

    // Preload skills for all bound projects
    for (const [, cwd] of config.channelProjects) {
      const skills = preloadSkills(cwd);
      if (skills.length > 0) {
        console.log(`[skills] ${cwd}: ${skills.join(", ")}`);
      }
    }
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;

    // --- Admin command: /bind <path> ---
    if (
      message.content.startsWith("/bind ") &&
      !message.channel.isThread()
    ) {
      const projectPath = message.content.slice("/bind ".length).trim();
      config.channelProjects.set(message.channel.id, projectPath);
      const skills = preloadSkills(projectPath);
      const skillInfo = skills.length > 0
        ? `\nAvailable skills: ${skills.map((s) => `\`/${s}\``).join(", ")}`
        : "";
      await message.reply(`Bound this channel to: \`${projectPath}\`${skillInfo}`);
      return;
    }

    // --- Admin command: /unbind ---
    if (message.content === "/unbind" && !message.channel.isThread()) {
      config.channelProjects.delete(message.channel.id);
      await message.reply("Unbound this channel.");
      return;
    }

    // --- Admin command: /projects ---
    if (message.content === "/projects") {
      if (config.channelProjects.size === 0) {
        await message.reply("No channels bound. Use `/bind <path>` in a channel.");
        return;
      }
      const list = [...config.channelProjects.entries()]
        .map(([id, path]) => `<#${id}> → \`${path}\``)
        .join("\n");
      await message.reply(`**Bound projects:**\n${list}`);
      return;
    }

    // --- Admin command: /skills ---
    if (message.content === "/skills") {
      // Resolve cwd from channel or parent channel
      const channelId = message.channel.isThread()
        ? message.channel.parentId || ""
        : message.channel.id;
      const cwd = resolveProjectCwd(channelId, config);
      if (!cwd) {
        await message.reply("This channel is not bound to a project.");
        return;
      }
      const skills = listSkills(cwd);
      if (skills.length === 0) {
        await message.reply("No skills found in this project or user config.");
      } else {
        await message.reply(
          `**Available skills:**\n${skills.map((s) => `\`/${s}\``).join(", ")}`
        );
      }
      return;
    }

    // --- Message in a channel (not a thread) → create thread ---
    if (!message.channel.isThread()) {
      const cwd = resolveProjectCwd(message.channel.id, config);
      if (!cwd) return;

      // Resolve skill if message starts with /
      const skill = resolveSkill(message.content, cwd);
      const prompt = skill
        ? buildSkillPrompt(skill, message.content)
        : message.content;
      const threadName = skill
        ? `/${skill.name} ${skill.args}`.slice(0, 95)
        : message.content.slice(0, 95) || "New task";

      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });

      if (skill) {
        await thread.send(`> Loaded skill: **${skill.name}**`);
      }

      await handleAgentRun(thread, prompt, cwd, thread.id, false);
      return;
    }

    // --- Message in a thread → continue session ---
    const parentId = message.channel.parentId;
    if (!parentId) return;

    const cwd = resolveProjectCwd(parentId, config);
    if (!cwd) return;

    // Resolve skill in thread messages too
    const skill = resolveSkill(message.content, cwd);
    const prompt = skill
      ? buildSkillPrompt(skill, message.content)
      : message.content;

    if (skill) {
      await message.channel.send(`> Loaded skill: **${skill.name}**`);
    }

    await handleAgentRun(
      message.channel,
      prompt,
      cwd,
      message.channel.id,
      true,
      message
    );
  });

  return client;
}
