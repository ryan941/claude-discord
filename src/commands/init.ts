import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { createInterface } from "readline";

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export async function runInit(configPath: string): Promise<void> {
  console.log("claude-discord setup\n");

  if (existsSync(configPath)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const overwrite = await ask(rl, `Config already exists at ${configPath}. Overwrite? (y/N)`, "N");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted.");
      rl.close();
      return;
    }
    rl.close();
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("At least one platform (Discord or Slack) must be configured.\n");

  // === Discord ===
  console.log("=== Discord Configuration (leave token empty to skip) ===");
  const discordToken = await ask(rl, "Discord Bot Token");
  let guildId = "";
  let categoryId = "";

  if (discordToken) {
    guildId = await ask(rl, "Discord Server (Guild) ID");
    categoryId = await ask(rl, 'Category ID (leave empty to auto-create "Projects")', "");
  }

  // === Slack ===
  console.log("\n=== Slack Configuration (leave token empty to skip) ===");
  const slackBotToken = await ask(rl, "Slack Bot Token (xoxb-...)");
  let slackAppToken = "";

  if (slackBotToken) {
    slackAppToken = await ask(rl, "Slack App Token (xapp-...)");
    if (!slackAppToken) {
      console.log("  Warning: Slack App Token is required for Socket Mode.");
    }
  }

  // Validate at least one platform
  if (!discordToken && !slackBotToken) {
    console.error("\nAt least one platform must be configured.");
    rl.close();
    process.exit(1);
  }

  // === Shared ===
  console.log("\n=== Shared Configuration ===");
  const homeDir = process.env.HOME || "~";
  const defaultWatchDir = `${homeDir}/Documents/code`;
  const watchDir = await ask(rl, "Projects directory to watch", defaultWatchDir);
  const anthropicKey = await ask(rl, "Anthropic API Key (leave empty if using claude login)", "");

  rl.close();

  // Build .env content
  const lines = [
    "# claude-discord configuration",
    `# Generated on ${new Date().toISOString()}`,
    "",
  ];

  // Discord section
  if (discordToken) {
    lines.push("# === Discord ===");
    lines.push(`DISCORD_TOKEN=${discordToken}`);
    lines.push(`GUILD_ID=${guildId}`);
    if (categoryId) {
      lines.push(`CATEGORY_ID=${categoryId}`);
    } else {
      lines.push("# CATEGORY_ID=");
    }
    lines.push("CHANNEL_PROJECTS={}");
    lines.push("");
  }

  // Slack section
  if (slackBotToken) {
    lines.push("# === Slack ===");
    lines.push(`SLACK_BOT_TOKEN=${slackBotToken}`);
    if (slackAppToken) {
      lines.push(`SLACK_APP_TOKEN=${slackAppToken}`);
    }
    lines.push("# SLACK_CHANNEL_PROJECTS={}");
    lines.push("");
  }

  // Shared section
  lines.push("# === Shared ===");
  lines.push(`WATCH_DIR=${watchDir}`);

  if (anthropicKey) {
    lines.push(`ANTHROPIC_API_KEY=${anthropicKey}`);
  } else {
    lines.push("# ANTHROPIC_API_KEY=");
  }

  lines.push("");

  const content = lines.join("\n");

  // Write config
  const configDir = dirname(configPath);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, content, "utf-8");

  console.log(`\nConfig saved to ${configPath}`);
  console.log("\nNext steps:");
  if (discordToken) {
    console.log('  - Discord: Invite bot to server with "Manage Channels" permission');
  }
  if (slackBotToken) {
    console.log("  - Slack: Enable Socket Mode and subscribe to message.channels event");
  }
  console.log('  - Run "claude-discord start" to start the bot');
  console.log('  - Or run "claude-discord install-service" to run it as a background service');
}
