// Legacy entry point — for backward compat with `npm run dev`
// Prefer using `claude-discord start` via the CLI.

import dotenv from "dotenv";
dotenv.config();

import { loadConfig } from "./config";
import { PlatformAdapter } from "./platforms/types";
import { createDiscordAdapter } from "./platforms/discord/bot";
import { createSlackAdapter } from "./platforms/slack/bot";

export async function startAll(platform?: "discord" | "slack" | "all"): Promise<PlatformAdapter[]> {
  const config = loadConfig();
  const adapters: PlatformAdapter[] = [];
  const target = platform || "all";

  if ((target === "all" || target === "discord") && config.discord) {
    adapters.push(createDiscordAdapter(config.discord, config.watchDir));
  }

  if ((target === "all" || target === "slack") && config.slack) {
    adapters.push(createSlackAdapter(config.slack, config.watchDir));
  }

  if (adapters.length === 0) {
    throw new Error(`No configured platform matches "${target}"`);
  }

  await Promise.all(adapters.map((a) => a.start()));

  console.log(`Running platforms: ${adapters.map((a) => a.name).join(", ")}`);
  return adapters;
}

// Direct execution: start all configured platforms
if (require.main === module) {
  startAll().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
