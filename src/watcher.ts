import { Client, ChannelType, TextChannel, CategoryChannel } from "discord.js";
import { readdirSync, watch, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { BotConfig } from "./config";

// project name → channel ID (managed channels only)
const managedChannels = new Map<string, string>();

// Directories to ignore (not real projects)
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "__pycache__",
  ".venv",
  "venv",
]);

function listProjectDirs(watchDir: string): string[] {
  if (!existsSync(watchDir)) return [];
  return readdirSync(watchDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !IGNORE_DIRS.has(d.name))
    .map((d) => d.name);
}

function projectToChannelName(name: string): string {
  // Discord channel names: lowercase, no spaces, max 100 chars
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 100);
}

async function getOrCreateCategory(
  client: Client,
  guildId: string,
  categoryId?: string
): Promise<CategoryChannel | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`[watcher] Guild ${guildId} not found`);
    return null;
  }

  // If a category ID is specified, use it
  if (categoryId) {
    const existing = guild.channels.cache.get(categoryId);
    if (existing && existing.type === ChannelType.GuildCategory) {
      return existing as CategoryChannel;
    }
  }

  // Otherwise, find or create a "Projects" category
  let category = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === "Projects"
  ) as CategoryChannel | undefined;

  if (!category) {
    category = await guild.channels.create({
      name: "Projects",
      type: ChannelType.GuildCategory,
    });
    console.log(`[watcher] Created category: Projects (${category.id})`);
  }

  return category;
}

async function createProjectChannel(
  client: Client,
  config: BotConfig,
  projectName: string,
  category: CategoryChannel
): Promise<void> {
  if (managedChannels.has(projectName)) return; // Already exists

  const channelName = projectToChannelName(projectName);
  const guild = client.guilds.cache.get(config.guildId!);
  if (!guild) return;

  // Check if channel already exists in the category
  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.name === channelName &&
      ch.parentId === category.id
  );

  if (existing) {
    // Channel exists, just register it
    const projectPath = join(config.watchDir!, projectName);
    managedChannels.set(projectName, existing.id);
    config.channelProjects.set(existing.id, projectPath);
    console.log(`[watcher] Relinked existing channel #${channelName} → ${projectPath}`);
    return;
  }

  // Create new channel
  const projectPath = join(config.watchDir!, projectName);
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    topic: `Project: ${projectPath}`,
  });

  managedChannels.set(projectName, channel.id);
  config.channelProjects.set(channel.id, projectPath);
  console.log(`[watcher] Created channel #${channelName} (${channel.id}) → ${projectPath}`);

  // Send welcome message
  await channel.send(
    `This channel is auto-linked to project \`${projectPath}\`.\nSend a message to start a Claude session.`
  );
}

async function removeProjectChannel(
  client: Client,
  config: BotConfig,
  projectName: string
): Promise<void> {
  const channelId = managedChannels.get(projectName);
  if (!channelId) return;

  const guild = client.guilds.cache.get(config.guildId!);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId);
  if (channel) {
    console.log(`[watcher] Removing channel #${channel.name} (project dir deleted)`);
    await channel.delete(`Project directory "${projectName}" was removed`);
  }

  config.channelProjects.delete(channelId);
  managedChannels.delete(projectName);
}

export async function syncProjects(
  client: Client,
  config: BotConfig
): Promise<void> {
  if (!config.watchDir || !config.guildId) {
    console.log("[watcher] WATCH_DIR or GUILD_ID not set, skipping sync");
    return;
  }

  const category = await getOrCreateCategory(
    client,
    config.guildId,
    config.categoryId
  );
  if (!category) return;

  const projects = listProjectDirs(config.watchDir);
  console.log(`[watcher] Found ${projects.length} project(s) in ${config.watchDir}`);

  for (const project of projects) {
    await createProjectChannel(client, config, project, category);
  }

  // Remove channels for deleted projects
  for (const [name] of managedChannels) {
    if (!projects.includes(name)) {
      await removeProjectChannel(client, config, name);
    }
  }
}

export function startWatcher(client: Client, config: BotConfig): void {
  if (!config.watchDir || !config.guildId) {
    console.log("[watcher] WATCH_DIR or GUILD_ID not set, watcher disabled");
    return;
  }

  const watchDir = config.watchDir;

  // Debounce: avoid rapid re-syncs when multiple fs events fire
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        await syncProjects(client, config);
      } catch (err) {
        console.error("[watcher] Sync error:", err);
      }
    }, 2000);
  };

  try {
    watch(watchDir, { persistent: true }, (eventType, filename) => {
      if (!filename || filename.startsWith(".") || IGNORE_DIRS.has(filename)) return;

      // Only care about directory-level changes
      const fullPath = join(watchDir, filename);
      const isDir = existsSync(fullPath) && statSync(fullPath).isDirectory();
      const wasManaged = managedChannels.has(filename);

      if (isDir || wasManaged) {
        console.log(`[watcher] Detected change: ${eventType} ${filename}`);
        debouncedSync();
      }
    });

    console.log(`[watcher] Watching ${watchDir} for project changes`);
  } catch (err) {
    console.error(`[watcher] Failed to watch ${watchDir}:`, err);
  }
}
