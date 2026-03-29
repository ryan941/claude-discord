import { App, LogLevel } from "@slack/bolt";
import { SlackConfig } from "../../config";
import { ChatChannel, PlatformAdapter, ReplyHandler, VerbosityMode, PermissionHandler } from "../types";
import { handleAgentRun } from "../utils";
import { resolveSkill, buildSkillPrompt, listSkills, preloadSkills } from "../../skills";
import { summarizeToolUse } from "../../agent";
import { syncSlackProjects, startSlackWatcher } from "./watcher";

const SLACK_MSG_LIMIT = 4000;

const EMOJI_MAP: Record<string, string> = {
  "⏳": "hourglass_flowing_sand",
  "✅": "white_check_mark",
  "❌": "x",
};

export function createSlackAdapter(config: SlackConfig, watchDir?: string): PlatformAdapter {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const channelVerbosity = new Map<string, VerbosityMode>();
  const getVerbosity = (channelId: string): VerbosityMode =>
    channelVerbosity.get(channelId) ?? "normal";

  // --- Permission confirmation infrastructure ---
  const pendingPermissions = new Map<string, (allowed: boolean) => void>();

  app.action(/^(perm_allow|perm_deny)_/, async ({ action, ack, client, body }) => {
    await ack();
    const act = action as { action_id: string };
    const parts = act.action_id.split("_");
    const allowed = parts[1] === "allow";
    const uniqueId = parts.slice(2).join("_");

    const resolve = pendingPermissions.get(uniqueId);
    if (resolve) {
      resolve(allowed);
      pendingPermissions.delete(uniqueId);
    }

    const msgBody = body as { container?: { channel_id?: string; message_ts?: string } };
    const ch = msgBody.container?.channel_id;
    const ts = msgBody.container?.message_ts;
    if (ch && ts) {
      const status = allowed ? "✅ *Allowed*" : "❌ *Denied*";
      await client.chat.update({ channel: ch, ts, blocks: [{ type: "section", text: { type: "mrkdwn", text: status } }], text: status }).catch(() => {});
    }
  });

  function createSlackPermissionHandler(
    slackClient: typeof app.client,
    ch: string,
    threadTs: string,
  ): PermissionHandler {
    return async (toolName, input, options) => {
      const summary = summarizeToolUse(toolName, input);
      const reason = options.decisionReason ? `\nReason: ${options.decisionReason}` : "";
      const uniqueId = `${Date.now()}_${options.toolUseID}`;

      await slackClient.chat.postMessage({
        channel: ch,
        thread_ts: threadTs,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `🔒 *Permission Required*\nTool: *${toolName}*\n${summary}${reason}` } },
          { type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: "✅ Allow" }, action_id: `perm_allow_${uniqueId}`, style: "primary" },
            { type: "button", text: { type: "plain_text", text: "❌ Deny" }, action_id: `perm_deny_${uniqueId}`, style: "danger" },
          ]},
        ],
        text: `🔒 Permission Required: ${toolName}`,
      });

      try {
        const userAllowed = await Promise.race<boolean>([
          new Promise<boolean>((resolve) => { pendingPermissions.set(uniqueId, resolve); }),
          new Promise<boolean>((_, reject) => { setTimeout(() => reject(new Error("timeout")), 60_000); }),
        ]);
        return userAllowed
          ? { behavior: "allow" as const }
          : { behavior: "deny" as const, message: "User denied via Slack" };
      } catch {
        pendingPermissions.delete(uniqueId);
        return { behavior: "deny" as const, message: "Permission timed out (60s)" };
      }
    };
  }

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
      // --- Admin command: /quiet, /normal, /verbose ---
      const verbosityCommands: Record<string, VerbosityMode> = {
        "/quiet": "quiet",
        "/normal": "normal",
        "/verbose": "verbose",
      };
      if (text in verbosityCommands) {
        if (!config.channelProjects.get(channelId)) return;
        const mode = verbosityCommands[text];
        channelVerbosity.set(channelId, mode);
        await client.chat.postMessage({
          channel: channelId,
          text: `Verbosity set to *${mode}*`,
          thread_ts: messageTs,
        });
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
        const res = await client.chat.postMessage({
          channel: channelId,
          text: t,
          thread_ts: replyTs,
        });
        return res.ts;
      },
      sendTyping: () => {
        // Slack has no persistent typing indicator API; noop
      },
      edit: async (messageId, text) => {
        await client.chat.update({
          channel: channelId,
          ts: messageId,
          text,
        });
      },
      react: async (messageId, emoji) => {
        const slackName = EMOJI_MAP[emoji] || emoji;
        await client.reactions.add({
          channel: channelId,
          timestamp: messageId,
          name: slackName,
        });
      },
      removeReact: async (messageId, emoji) => {
        const slackName = EMOJI_MAP[emoji] || emoji;
        await client.reactions.remove({
          channel: channelId,
          timestamp: messageId,
          name: slackName,
        });
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
    const verbosity = getVerbosity(channelId);
    const permHandler = createSlackPermissionHandler(client, channelId, replyTs);
    await handleAgentRun(chatChannel, prompt, cwd, sessionKey, reply, SLACK_MSG_LIMIT, verbosity, messageTs, permHandler);
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
