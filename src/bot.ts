import {
  Client,
  GatewayIntentBits,
  Message,
  MessageType,
  Partials,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { BotConfig } from "./config";
import { runAgent } from "./agent";

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
      await message.reply(`Bound this channel to: \`${projectPath}\``);
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

    // --- Message in a channel (not a thread) → create thread ---
    if (!message.channel.isThread()) {
      const cwd = resolveProjectCwd(message.channel.id, config);
      if (!cwd) return; // Not a bound channel, ignore

      const threadName = message.content.slice(0, 95) || "New task";

      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });

      await thread.sendTyping();

      try {
        const result = await runAgent(message.content, cwd, thread.id);
        const chunks = splitMessage(result.text || "(no response)");
        for (const chunk of chunks) {
          await thread.send(chunk);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await thread.send(`Agent error: ${errorMsg}`);
      }
      return;
    }

    // --- Message in a thread → continue session ---
    const parentId = message.channel.parentId;
    if (!parentId) return;

    const cwd = resolveProjectCwd(parentId, config);
    if (!cwd) return; // Parent channel not bound

    await message.channel.sendTyping();

    try {
      const result = await runAgent(
        message.content,
        cwd,
        message.channel.id
      );
      const chunks = splitMessage(result.text || "(no response)");
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await message.reply(`Agent error: ${errorMsg}`);
    }
  });

  return client;
}
