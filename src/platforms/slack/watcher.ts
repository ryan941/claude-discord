import { App } from "@slack/bolt";
import { watch, statSync, existsSync } from "fs";
import { join } from "path";
import { SlackConfig } from "../../config";
import { preloadSkills } from "../../skills";
import { listProjectDirs, projectToChannelName, IGNORE_DIRS } from "../utils";

// project name → channel ID (managed channels only)
const managedChannels = new Map<string, string>();

async function createProjectChannel(
  app: App,
  config: SlackConfig,
  projectName: string,
  watchDir: string
): Promise<void> {
  if (managedChannels.has(projectName)) return;

  const channelName = `claude-${projectToChannelName(projectName)}`;
  const projectPath = join(watchDir, projectName);

  // Check if channel already exists
  try {
    const result = await app.client.conversations.list({
      types: "public_channel",
      limit: 1000,
    });

    const existing = result.channels?.find((ch) => ch.name === channelName && !ch.is_archived);
    if (existing && existing.id) {
      managedChannels.set(projectName, existing.id);
      config.channelProjects.set(existing.id, projectPath);
      console.log(`[slack][watcher] Relinked existing channel #${channelName} → ${projectPath}`);
      return;
    }
  } catch (err) {
    console.error(`[slack][watcher] Failed to list channels:`, err);
  }

  // Create new channel
  try {
    const result = await app.client.conversations.create({
      name: channelName,
    });

    const channelId = result.channel?.id;
    if (!channelId) return;

    managedChannels.set(projectName, channelId);
    config.channelProjects.set(channelId, projectPath);
    console.log(`[slack][watcher] Created channel #${channelName} (${channelId}) → ${projectPath}`);

    // Set topic
    await app.client.conversations.setTopic({
      channel: channelId,
      topic: `Project: ${projectPath}`,
    }).catch(() => {});

    // Send welcome message
    const skills = preloadSkills(projectPath);
    const skillInfo = skills.length > 0
      ? `\nAvailable skills: ${skills.map((s) => `\`/${s}\``).join(", ")}`
      : "";

    await app.client.chat.postMessage({
      channel: channelId,
      text: `This channel is auto-linked to project \`${projectPath}\`.${skillInfo}\nSend a message to start a Claude session.`,
    });
  } catch (err) {
    // Channel name might already exist (archived) or lack permissions
    console.error(`[slack][watcher] Failed to create channel #${channelName}:`, err);
  }
}

async function removeProjectChannel(
  app: App,
  config: SlackConfig,
  projectName: string
): Promise<void> {
  const channelId = managedChannels.get(projectName);
  if (!channelId) return;

  try {
    console.log(`[slack][watcher] Archiving channel for removed project: ${projectName}`);
    await app.client.conversations.archive({ channel: channelId });
  } catch (err) {
    console.error(`[slack][watcher] Failed to archive channel:`, err);
  }

  config.channelProjects.delete(channelId);
  managedChannels.delete(projectName);
}

export async function syncSlackProjects(
  app: App,
  config: SlackConfig,
  watchDir: string
): Promise<void> {
  const projects = listProjectDirs(watchDir);
  const projectNames = projects.map((p) => p.name);
  console.log(`[slack][watcher] Found ${projects.length} project(s) in ${watchDir}`);

  for (const project of projects) {
    await createProjectChannel(app, config, project.name, watchDir);
  }

  // Archive channels for deleted projects
  for (const [name] of managedChannels) {
    if (!projectNames.includes(name)) {
      await removeProjectChannel(app, config, name);
    }
  }
}

export function startSlackWatcher(app: App, config: SlackConfig, watchDir: string): void {
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        await syncSlackProjects(app, config, watchDir);
      } catch (err) {
        console.error("[slack][watcher] Sync error:", err);
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
        console.log(`[slack][watcher] Detected change: ${eventType} ${filename}`);
        debouncedSync();
      }
    });

    console.log(`[slack][watcher] Watching ${watchDir} for project changes`);
  } catch (err) {
    console.error(`[slack][watcher] Failed to watch ${watchDir}:`, err);
  }
}
