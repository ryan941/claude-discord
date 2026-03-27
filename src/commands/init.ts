import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
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

  console.log("You'll need:");
  console.log("  1. A Discord Bot Token (https://discord.com/developers/applications)");
  console.log("  2. Your Discord Server (Guild) ID");
  console.log("  3. The directory where your code projects live\n");

  const discordToken = await ask(rl, "Discord Bot Token");
  if (!discordToken) {
    console.error("Discord Bot Token is required.");
    rl.close();
    process.exit(1);
  }

  const guildId = await ask(rl, "Discord Server (Guild) ID");
  if (!guildId) {
    console.error("Guild ID is required.");
    rl.close();
    process.exit(1);
  }

  const homeDir = process.env.HOME || "~";
  const defaultWatchDir = `${homeDir}/Documents/code`;
  const watchDir = await ask(rl, "Projects directory to watch", defaultWatchDir);

  const categoryId = await ask(rl, 'Category ID (leave empty to auto-create "Projects")', "");

  const anthropicKey = await ask(rl, "Anthropic API Key (leave empty if using claude login)", "");

  rl.close();

  // Build .env content
  const lines = [
    "# claude-discord configuration",
    `# Generated on ${new Date().toISOString()}`,
    "",
    `DISCORD_TOKEN=${discordToken}`,
    "",
    `GUILD_ID=${guildId}`,
    `WATCH_DIR=${watchDir}`,
  ];

  if (categoryId) {
    lines.push(`CATEGORY_ID=${categoryId}`);
  } else {
    lines.push("# CATEGORY_ID=");
  }

  lines.push("");

  if (anthropicKey) {
    lines.push(`ANTHROPIC_API_KEY=${anthropicKey}`);
  } else {
    lines.push("# ANTHROPIC_API_KEY=");
  }

  lines.push("");
  lines.push("# Manual channel bindings (optional, JSON format)");
  lines.push("CHANNEL_PROJECTS={}");
  lines.push("");

  const content = lines.join("\n");

  // Write config
  const configDir = dirname(configPath);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, content, "utf-8");

  console.log(`\nConfig saved to ${configPath}`);
  console.log('\nNext steps:');
  console.log('  1. Make sure your bot is invited to the server with "Manage Channels" permission');
  console.log('  2. Run "claude-discord start" to start the bot');
  console.log('  3. Or run "claude-discord install-service" to run it as a background service');
}
