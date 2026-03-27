export interface DiscordConfig {
  token: string;
  channelProjects: Map<string, string>;
  guildId?: string;
  categoryId?: string;
}

export interface SlackConfig {
  botToken: string;
  appToken: string;
  channelProjects: Map<string, string>;
}

export interface AppConfig {
  discord?: DiscordConfig;
  slack?: SlackConfig;
  watchDir?: string;
}

function parseChannelProjects(raw?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [channelId, projectPath] of Object.entries(parsed)) {
      map.set(channelId, projectPath);
    }
  } catch {}
  return map;
}

export function loadConfig(): AppConfig {
  const discord: DiscordConfig | undefined = process.env.DISCORD_TOKEN
    ? {
        token: process.env.DISCORD_TOKEN,
        channelProjects: parseChannelProjects(process.env.CHANNEL_PROJECTS),
        guildId: process.env.GUILD_ID,
        categoryId: process.env.CATEGORY_ID,
      }
    : undefined;

  const slack: SlackConfig | undefined =
    process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN
      ? {
          botToken: process.env.SLACK_BOT_TOKEN,
          appToken: process.env.SLACK_APP_TOKEN,
          channelProjects: parseChannelProjects(process.env.SLACK_CHANNEL_PROJECTS),
        }
      : undefined;

  if (!discord && !slack) {
    throw new Error(
      "At least one platform must be configured. Set DISCORD_TOKEN or SLACK_BOT_TOKEN + SLACK_APP_TOKEN."
    );
  }

  return {
    discord,
    slack,
    watchDir: process.env.WATCH_DIR,
  };
}