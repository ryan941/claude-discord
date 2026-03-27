import dotenv from "dotenv";
import { startAll } from "../index";

export async function runStart(
  configPath: string,
  platform?: "discord" | "slack" | "all"
): Promise<void> {
  // Load env from the specified config path
  dotenv.config({ path: configPath, override: true });

  const adapters = await startAll(platform);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await Promise.all(adapters.map((a) => a.stop().catch(() => {})));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
