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

// Debounced progress sender — batches rapid tool events
function createProgressSender(channel: TextChannel | ThreadChannel) {
  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (queue.length === 0) return;
    const lines = queue.splice(0);
    const text = lines.join("\n").slice(0, DISCORD_MSG_LIMIT);
    try {
      await channel.send(text);
    } catch {}
  };

  return {
    push(line: string) {
      queue.push(line);
      if (timer) clearTimeout(timer);
      // Batch events within 1.5s to avoid flooding
      timer = setTimeout(flush, 1500);
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

  const callbacks: StreamCallbacks = {
    onToolUse(event) {
      progress.push(`> ${event.summary}`);
    },
  };

  try {
    const result = await runAgent(prompt, cwd, threadId, callbacks);

    // Flush any remaining progress messages
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
