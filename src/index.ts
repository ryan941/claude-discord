// Legacy entry point — for backward compat with `npm run dev`
// Prefer using `claude-discord start` via the CLI.

import dotenv from "dotenv";
dotenv.config();

import { loadConfig } from "./config";
import { createBot } from "./bot";
import { syncProjects, startWatcher } from "./watcher";

async function main() {
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

  await bot.login(config.discordToken);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
