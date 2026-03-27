#!/usr/bin/env node

import { resolve } from "path";
import { existsSync } from "fs";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
claude-discord — Run Claude Code from Discord and Slack

Usage:
  claude-discord <command> [options]

Commands:
  init              Interactive setup wizard (creates config)
  start             Start the bot (foreground)
  install-service   Install as a background service (macOS LaunchAgent / Linux systemd)
  uninstall-service Remove the background service
  status            Show service status and config info

Options:
  -c, --config <path>       Path to .env config file (default: ~/.claude-discord/.env)
  -p, --platform <platform> Platform to start: discord, slack, or all (default: all)
  -h, --help                Show this help message
  -v, --version             Show version
`);
}

function getConfigPath(): string {
  const idx = args.indexOf("-c") !== -1 ? args.indexOf("-c") : args.indexOf("--config");
  if (idx !== -1 && args[idx + 1]) {
    return resolve(args[idx + 1]);
  }
  return resolve(process.env.HOME || "~", ".claude-discord", ".env");
}

function getPlatform(): "discord" | "slack" | "all" {
  const idx = args.indexOf("-p") !== -1 ? args.indexOf("-p") : args.indexOf("--platform");
  if (idx !== -1 && args[idx + 1]) {
    const val = args[idx + 1];
    if (val === "discord" || val === "slack" || val === "all") return val;
    console.error(`Invalid platform: ${val}. Must be discord, slack, or all.`);
    process.exit(1);
  }
  return "all";
}

async function main(): Promise<void> {
  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "-v" || command === "--version") {
    const pkg = require("../package.json");
    console.log(pkg.version);
    return;
  }

  const configPath = getConfigPath();

  switch (command) {
    case "init": {
      const { runInit } = await import("./commands/init");
      await runInit(configPath);
      break;
    }
    case "start": {
      if (!existsSync(configPath)) {
        console.error(`Config not found at ${configPath}`);
        console.error('Run "claude-discord init" first.');
        process.exit(1);
      }
      const platform = getPlatform();
      const { runStart } = await import("./commands/start");
      await runStart(configPath, platform);
      break;
    }
    case "install-service": {
      if (!existsSync(configPath)) {
        console.error(`Config not found at ${configPath}`);
        console.error('Run "claude-discord init" first.');
        process.exit(1);
      }
      const { runInstallService } = await import("./commands/install-service");
      await runInstallService(configPath);
      break;
    }
    case "uninstall-service": {
      const { runUninstallService } = await import("./commands/uninstall-service");
      await runUninstallService();
      break;
    }
    case "status": {
      const { runStatus } = await import("./commands/status");
      await runStatus(configPath);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
