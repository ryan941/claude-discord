import { App, LogLevel } from "@slack/bolt";
import { SlackConfig } from "../../config";
import { ChatChannel, PlatformAdapter, ReplyHandler } from "../types";
import { handleAgentRun } from "../utils";
import { resolveSkill, buildSkillPrompt, listSkills, preloadSkills } from "../../skills";
import { syncSlackProjects, startSlackWatcher } from "./watcher";

const SLACK_MSG_LIMIT = 4000;

export function createSlackAdapter(config: SlackConfig, watchDir?: string): PlatformAdapter {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Listen to all messages
  app.event("message", async ({ event, client }) => {
    // Filter bot messages
    if ("bot_id" in event || event.subtype) return;

    const text = "text" in event ? (event as any).text || "" : "";
    const channelId = event.channel;
    const threadTs = "thread_ts" in event ? (event as any).thread_ts as string | undefined : undefined;
    const messageTs = (event as any).ts as string;

    // --- Admin commands (non-thread only) ---
    if (!threadTs) {
      if (text.startsWith("/bind ")) {
        const projectPath = text.slice("/bind ".length).trim();
        config.channelProjects.set(channelId, projectPath);
        const skills = preloadSkills(projectPath);
        const skillInfo = skills.length > 0
          ? `\nAvailable skills: ${skills.map((s: string) => `\`/${s}\``).join(", ")}`
          : "";
        await client.chat.postMessage({
          channel: channelId,
          text: `Bound this channel to: \`${projectPath}\`${skillInfo}`,
          thread_ts: messageTs,
        });
        return;
      }

      if (text === "/unbind") {
        config.channelProjects.delete(channelId);
        await client.chat.postMessage({
          channel: channelId,
          text: "Unbound this channel.",
          thread_ts: messageTs,
        });
        return;
      }

      if (text === "/projects") {
        if (config.channelProjects.size === 0) {
          await client.chat.postMessage({
            channel: channelId,
            text: "No channels bound. Use `/bind <path>` in a channel.",
            thread_ts: messageTs,
          });
          return;
        }
        const list = [...config.channelProjects.entries()]
          .map(([id, path]) => `<#${id}> → \`${path}\``)
          .join("\n");
        await client.chat.postMessage({
          channel: channelId,
          text: `*Bound projects:*\n${list}`,
          thread_ts: messageTs,
        });
        return;
      }

      if (text === "/skills") {
        const cwd = config.channelProjects.get(channelId);
        if (!cwd) {
          await client.chat.postMessage({
            channel: channelId,
            text: "This channel is not bound to a project.",
            thread_ts: messageTs,
          });
          return;
        }
        const skills = listSkills(cwd);
        if (skills.length === 0) {
          await client.chat.postMessage({
            channel: channelId,
            text: "No skills found in this project or user config.",
            thread_ts: messageTs,
          });
        } else {
          await client.chat.postMessage({
            channel: channelId,
            text: `*Available skills:*\n${skills.map((s: string) => `\`/${s}\``).join(", ")}`,
            thread_ts: messageTs,
          });
        }
        return;
      }
    }

    // --- Resolve project ---
    const cwd = config.channelProjects.get(channelId);
    if (!cwd) return;

    // --- Resolve skill ---
    const skill = resolveSkill(text, cwd);
    const prompt = skill ? buildSkillPrompt(skill, text) : text;

    // Session key: thread parent ts (if in thread) or message ts (new thread)
    const sessionKey = threadTs || messageTs;
    const replyTs = threadTs || messageTs;

    // --- Wrap as ChatChannel ---
    const chatChannel: ChatChannel = {
      send: async (t) => {
        await client.chat.postMessage({
          channel: channelId,
          text: t,
          thread_ts: replyTs,
        });
      },
      sendTyping: () => {
        // Slack has no persistent typing indicator API; noop
      },
    };

    // --- Reply handler ---
    const reply: ReplyHandler = {
      sendResult: async (chunk) => {
        await client.chat.postMessage({
          channel: channelId,
          text: chunk,
          thread_ts: replyTs,
        });
      },
      sendError: async (errMsg) => {
        await client.chat.postMessage({
          channel: channelId,
          text: `Agent error: ${errMsg}`,
          thread_ts: replyTs,
        });
      },
    };

    // --- Notify skill ---
    if (skill) {
      await chatChannel.send(`> Loaded skill: *${skill.name}*`);
    }

    // --- Run agent ---
    await handleAgentRun(chatChannel, prompt, cwd, sessionKey, reply, SLACK_MSG_LIMIT);
  });

  return {
    name: "slack",
    async start() {
      await app.start();
      console.log("[slack] Bot online (Socket Mode)");

      for (const [, cwd] of config.channelProjects) {
        const skills = preloadSkills(cwd);
        if (skills.length > 0) {
          console.log(`[slack][skills] ${cwd}: ${skills.join(", ")}`);
        }
      }

      if (watchDir) {
        try {
          await syncSlackProjects(app, config, watchDir);
          startSlackWatcher(app, config, watchDir);
        } catch (err) {
          console.error("[slack][watcher] Initial sync failed:", err);
        }
      }
    },
    async stop() {
      await app.stop();
    },
  };
}
