import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import dotenv from "dotenv";

const SERVICE_LABEL = "com.claude-discord.bot";

export async function runStatus(configPath: string): Promise<void> {
  console.log("claude-discord status\n");

  // Config
  if (existsSync(configPath)) {
    console.log(`Config: ${configPath}`);
    const env = dotenv.parse(readFileSync(configPath, "utf-8"));
    console.log(`  GUILD_ID:   ${env.GUILD_ID || "(not set)"}`);
    console.log(`  WATCH_DIR:  ${env.WATCH_DIR || "(not set)"}`);
    console.log(`  Token:      ${env.DISCORD_TOKEN ? "****" + env.DISCORD_TOKEN.slice(-4) : "(not set)"}`);
  } else {
    console.log(`Config: not found at ${configPath}`);
    console.log('  Run "claude-discord init" to create one.');
  }

  console.log("");

  // Service status
  const platform = process.platform;

  if (platform === "darwin") {
    const plistPath = resolve(process.env.HOME!, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    if (existsSync(plistPath)) {
      console.log(`LaunchAgent: installed (${plistPath})`);
      try {
        const output = execSync(`launchctl list | grep ${SERVICE_LABEL}`, { encoding: "utf-8" }).trim();
        if (output) {
          const parts = output.split("\t");
          const pid = parts[0];
          const exitCode = parts[1];
          if (pid && pid !== "-") {
            console.log(`  Status: running (PID ${pid})`);
          } else {
            console.log(`  Status: not running (last exit code: ${exitCode})`);
          }
        }
      } catch {
        console.log("  Status: not loaded");
      }
    } else {
      console.log("LaunchAgent: not installed");
    }

    // Log files
    const logDir = resolve(process.env.HOME!, ".claude-discord", "logs");
    if (existsSync(resolve(logDir, "stdout.log"))) {
      console.log(`\nLogs: ${logDir}/`);
    }

  } else if (platform === "linux") {
    try {
      const output = execSync("systemctl --user is-active claude-discord", { encoding: "utf-8" }).trim();
      console.log(`Systemd service: ${output}`);
    } catch {
      console.log("Systemd service: not installed or inactive");
    }
  }
}
