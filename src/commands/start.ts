import dotenv from "dotenv";
import { loadConfig } from "../config";
import { createBot } from "../bot";
import { syncProjects, startWatcher } from "../watcher";

export async function runStart(configPath: string): Promise<void> {
  // Load env from the specified config path
  dotenv.config({ path: configPath, override: true });

  const config = loadConfig();
  const bot = createBot(config);

  bot.once("clientReady", async () => {
    try {
      await syncProjects(bot, config);
      startWatcher(bot, config);
    } catch (err) {
      console.error("[watcher] Initial sync failed:", err);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    bot.destroy();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await bot.login(config.discordToken);
}
