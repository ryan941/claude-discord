import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  GatewayIntentBits,
  Message,
  MessageType,
  Partials,
  TextChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { DiscordConfig } from "../../config";
import { ChatChannel, PlatformAdapter, ReplyHandler, VerbosityMode, PermissionHandler } from "../types";
import { handleAgentRun, splitMessage } from "../utils";
import { resolveSkill, buildSkillPrompt, listSkills, preloadSkills } from "../../skills";
import { summarizeToolUse } from "../../agent";
import { syncProjects, startWatcher } from "./watcher";

const MSG_LIMIT = 2000;

function wrapDiscordChannel(ch: TextChannel | ThreadChannel): { channel: ChatChannel; stop: () => void } {
  let alive = true;

  const tick = () => {
    if (!alive) return;
    ch.sendTyping().catch(() => {});
    setTimeout(tick, 8000);
  };

  return {
    channel: {
      send: async (text) => {
        const msg = await ch.send(text);
        return msg.id;
      },
      sendTyping: () => { alive = true; tick(); },
      edit: async (messageId, text) => {
        const msg = await ch.messages.fetch(messageId);
        await msg.edit(text);
      },
      react: async (messageId, emoji) => {
        const msg = await ch.messages.fetch(messageId);
        await msg.react(emoji);
      },
      removeReact: async (messageId, emoji) => {
        const msg = await ch.messages.fetch(messageId);
        const reaction = msg.reactions.cache.find((r) => r.emoji.name === emoji);
        if (reaction) await reaction.users.remove(ch.client.user?.id);
      },
    },
    stop: () => { alive = false; },
  };
}

function createDiscordPermissionHandler(thread: ThreadChannel): PermissionHandler {
  return async (toolName, input, options) => {
    const summary = summarizeToolUse(toolName, input);
    const reason = options.decisionReason ? `\nReason: ${options.decisionReason}` : "";

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`allow_${options.toolUseID}`)
        .setLabel("Allow")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`deny_${options.toolUseID}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await thread.send({
      content: `🔒 **Permission Required**\nTool: **${toolName}**\n${summary}${reason}`,
      components: [row],
    });

    try {
      const interaction = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60_000,
      });

      if (interaction.customId.startsWith("allow")) {
        await interaction.update({
          content: `✅ **Allowed:** ${toolName} — ${summary}`,
          components: [],
        });
        return { behavior: "allow" as const };
      } else {
        await interaction.update({
          content: `❌ **Denied:** ${toolName} — ${summary}`,
          components: [],
        });
        return { behavior: "deny" as const, message: "User denied via Discord" };
      }
    } catch {
      await msg.edit({
        content: `⏰ **Timed out:** ${toolName} — ${summary}`,
        components: [],
      }).catch(() => {});
      return { behavior: "deny" as const, message: "Permission timed out (60s)" };
    }
  };
}

function resolveProjectCwd(channelId: string, config: DiscordConfig): string | null {
  return config.channelProjects.get(channelId) ?? null;
}

export function createDiscordAdapter(config: DiscordConfig, watchDir?: string): PlatformAdapter {
  const channelVerbosity = new Map<string, VerbosityMode>();
  const getVerbosity = (channelId: string): VerbosityMode =>
    channelVerbosity.get(channelId) ?? "normal";

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once("clientReady", (c) => {
    console.log(`[discord] Bot online: ${c.user.tag}`);
    console.log(
      `[discord] Mapped channels: ${[...config.channelProjects.entries()].map(([id, path]) => `${id} → ${path}`).join(", ")}`
    );

    for (const [, cwd] of config.channelProjects) {
      const skills = preloadSkills(cwd);
      if (skills.length > 0) {
        console.log(`[discord][skills] ${cwd}: ${skills.join(", ")}`);
      }
    }

    if (watchDir && config.guildId) {
      syncProjects(client, config, watchDir).catch((err) => {
        console.error("[discord][watcher] Initial sync failed:", err);
      });
      startWatcher(client, config, watchDir);
    }
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;

    // --- Admin command: /bind <path> ---
    if (message.content.startsWith("/bind ") && !message.channel.isThread()) {
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

    // --- Admin command: /quiet, /normal, /verbose ---
    const verbosityCommands: Record<string, VerbosityMode> = {
      "/quiet": "quiet",
      "/normal": "normal",
      "/verbose": "verbose",
    };
    if (message.content in verbosityCommands && !message.channel.isThread()) {
      const channelId = message.channel.id;
      if (!resolveProjectCwd(channelId, config)) return;
      const mode = verbosityCommands[message.content];
      channelVerbosity.set(channelId, mode);
      await message.reply(`Verbosity set to **${mode}**`);
      return;
    }

    // --- Message in a channel (not a thread) → create thread ---
    if (!message.channel.isThread()) {
      let cwd = resolveProjectCwd(message.channel.id, config);

      // Allow /capture in unbound channels — it only writes to Obsidian, no project needed
      if (!cwd) {
        const isCapture = message.content.toLowerCase().startsWith("/capture");
        if (!isCapture) return;
        cwd = process.env.HOME || "/tmp";
      }

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

      const { channel: chatChannel, stop } = wrapDiscordChannel(thread);
      const reply: ReplyHandler = {
        sendResult: async (chunk) => { await thread.send(chunk); },
        sendError: async (errMsg) => { await thread.send(`Agent error: ${errMsg}`); },
      };

      const verbosity = getVerbosity(message.channel.id);
      const permHandler = createDiscordPermissionHandler(thread);
      await handleAgentRun(chatChannel, prompt, cwd, thread.id, reply, MSG_LIMIT, verbosity, message.id, permHandler);
      stop();
      return;
    }

    // --- Message in a thread → continue session ---
    const parentId = message.channel.parentId;
    if (!parentId) return;

    let cwd = resolveProjectCwd(parentId, config);
    if (!cwd) {
      const isCapture = message.content.toLowerCase().startsWith("/capture");
      if (!isCapture) return;
      cwd = process.env.HOME || "/tmp";
    }

    const skill = resolveSkill(message.content, cwd);
    const prompt = skill
      ? buildSkillPrompt(skill, message.content)
      : message.content;

    const threadChannel = message.channel as ThreadChannel;

    if (skill) {
      await threadChannel.send(`> Loaded skill: **${skill.name}**`);
    }
    const { channel: chatChannel, stop } = wrapDiscordChannel(threadChannel);
    let replyTarget: Message | undefined = message;
    const reply: ReplyHandler = {
      sendResult: async (chunk, isFirst) => {
        if (isFirst && replyTarget) {
          await replyTarget.reply(chunk);
          replyTarget = undefined;
        } else {
          await threadChannel.send(chunk);
        }
      },
      sendError: async (errMsg) => {
        if (replyTarget) {
          await replyTarget.reply(`Agent error: ${errMsg}`);
        } else {
          await threadChannel.send(`Agent error: ${errMsg}`);
        }
      },
    };

    const verbosity = getVerbosity(parentId);
    const permHandler = createDiscordPermissionHandler(threadChannel);
    await handleAgentRun(chatChannel, prompt, cwd, threadChannel.id, reply, MSG_LIMIT, verbosity, message.id, permHandler);
    stop();
  });

  return {
    name: "discord",
    async start() {
      await client.login(config.token);
    },
    async stop() {
      client.destroy();
    },
  };
}
