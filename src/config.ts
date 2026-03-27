export interface BotConfig {
  discordToken: string;
  channelProjects: Map<string, string>; // channelId → project cwd
  guildId?: string;       // Discord server ID for auto-channel management
  watchDir?: string;      // Directory to watch for project folders
  categoryId?: string;    // Optional: category to put project channels under
}

export function loadConfig(): BotConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  if (!discordToken) {
    throw new Error("Missing DISCORD_TOKEN in .env");
  }

  const channelProjects = new Map<string, string>();
  const raw = process.env.CHANNEL_PROJECTS;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [channelId, projectPath] of Object.entries(parsed)) {
      channelProjects.set(channelId, projectPath);
    }
  }

  const guildId = process.env.GUILD_ID;
  const watchDir = process.env.WATCH_DIR;
  const categoryId = process.env.CATEGORY_ID;

  return { discordToken, channelProjects, guildId, watchDir, categoryId };
}
