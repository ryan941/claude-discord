import { Client, ChannelType, TextChannel, CategoryChannel } from "discord.js";
import { watch, statSync, existsSync } from "fs";
import { join } from "path";
import { DiscordConfig } from "../../config";
import { preloadSkills } from "../../skills";
import { listProjectDirs, projectToChannelName, IGNORE_DIRS, ProjectInfo } from "../utils";

const managedChannels = new Map<string, string>();

async function getOrCreateCategory(
  client: Client,
  guildId: string,
  categoryId?: string
): Promise<CategoryChannel | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`[discord][watcher] Guild ${guildId} not found`);
    return null;
  }

  if (categoryId) {
    const existing = guild.channels.cache.get(categoryId);
    if (existing && existing.type === ChannelType.GuildCategory) {
      return existing as CategoryChannel;
    }
  }

  let category = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === "Projects"
  ) as CategoryChannel | undefined;

  if (!category) {
    category = await guild.channels.create({
      name: "Projects",
      type: ChannelType.GuildCategory,
    });
    console.log(`[discord][watcher] Created category: Projects (${category.id})`);
  }

  return category;
}

async function createProjectChannel(
  client: Client,
  config: DiscordConfig,
  projectName: string,
  category: CategoryChannel,
  watchDir: string
): Promise<void> {
  if (managedChannels.has(projectName)) return;

  const channelName = projectToChannelName(projectName);
  const guild = client.guilds.cache.get(config.guildId!);
  if (!guild) return;

  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.name === channelName &&
      ch.parentId === category.id
  );

  if (existing) {
    const projectPath = join(watchDir, projectName);
    managedChannels.set(projectName, existing.id);
    config.channelProjects.set(existing.id, projectPath);
    console.log(`[discord][watcher] Relinked existing channel #${channelName} → ${projectPath}`);
    return;
  }

  const projectPath = join(watchDir, projectName);
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    topic: `Project: ${projectPath}`,
  });

  managedChannels.set(projectName, channel.id);
  config.channelProjects.set(channel.id, projectPath);
  console.log(`[discord][watcher] Created channel #${channelName} (${channel.id}) → ${projectPath}`);

  const skills = preloadSkills(projectPath);
  const skillInfo = skills.length > 0
    ? `\nAvailable skills: ${skills.map((s) => `\`/${s}\``).join(", ")}`
    : "";

  await channel.send(
    `This channel is auto-linked to project \`${projectPath}\`.${skillInfo}\nSend a message to start a Claude session.`
  );
}

async function removeProjectChannel(
  client: Client,
  config: DiscordConfig,
  projectName: string
): Promise<void> {
  const channelId = managedChannels.get(projectName);
  if (!channelId) return;

  const guild = client.guilds.cache.get(config.guildId!);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId);
  if (channel) {
    console.log(`[discord][watcher] Removing channel #${channel.name} (project dir deleted)`);
    await channel.delete(`Project directory "${projectName}" was removed`);
  }

  config.channelProjects.delete(channelId);
  managedChannels.delete(projectName);
}

async function reorderChannels(
  client: Client,
  config: DiscordConfig,
  projects: ProjectInfo[],
  category: CategoryChannel
): Promise<void> {
  const guild = client.guilds.cache.get(config.guildId!);
  if (!guild) return;

  const positionUpdates: { channel: string; position: number }[] = [];

  for (let i = 0; i < projects.length; i++) {
    const channelId = managedChannels.get(projects[i].name);
    if (!channelId) continue;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    if (!("position" in channel) || channel.position !== i) {
      positionUpdates.push({ channel: channelId, position: i });
    }
  }

  if (positionUpdates.length === 0) return;

  try {
    await guild.channels.setPositions(
      positionUpdates.map((u) => ({
        channel: u.channel,
        position: u.position,
        parent: category.id,
      }))
    );
    console.log(`[discord][watcher] Reordered ${positionUpdates.length} channel(s) by recent activity`);
  } catch (err) {
    console.error("[discord][watcher] Failed to reorder channels:", err);
  }
}

export async function syncProjects(
  client: Client,
  config: DiscordConfig,
  watchDir: string
): Promise<void> {
  if (!config.guildId) {
    console.log("[discord][watcher] GUILD_ID not set, skipping sync");
    return;
  }

  const category = await getOrCreateCategory(client, config.guildId, config.categoryId);
  if (!category) return;

  const projects = listProjectDirs(watchDir);
  const projectNames = projects.map((p) => p.name);
  console.log(`[discord][watcher] Found ${projects.length} project(s) in ${watchDir}`);

  for (const project of projects) {
    await createProjectChannel(client, config, project.name, category, watchDir);
  }

  for (const [name] of managedChannels) {
    if (!projectNames.includes(name)) {
      await removeProjectChannel(client, config, name);
    }
  }

  await reorderChannels(client, config, projects, category);
}

export function startWatcher(client: Client, config: DiscordConfig, watchDir: string): void {
  if (!config.guildId) {
    console.log("[discord][watcher] GUILD_ID not set, watcher disabled");
    return;
  }

  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        await syncProjects(client, config, watchDir);
      } catch (err) {
        console.error("[discord][watcher] Sync error:", err);
      }
    }, 2000);
  };

  try {
    watch(watchDir, { persistent: true }, (eventType, filename) => {
      if (!filename || filename.startsWith(".") || IGNORE_DIRS.has(filename)) return;

      const fullPath = join(watchDir, filename);
      const isDir = existsSync(fullPath) && statSync(fullPath).isDirectory();
      const wasManaged = managedChannels.has(filename);

      if (isDir || wasManaged) {
        console.log(`[discord][watcher] Detected change: ${eventType} ${filename}`);
        debouncedSync();
      }
    });

    console.log(`[discord][watcher] Watching ${watchDir} for project changes`);
  } catch (err) {
    console.error(`[discord][watcher] Failed to watch ${watchDir}:`, err);
  }
}
