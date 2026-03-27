import { existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const SERVICE_LABEL = "com.claude-discord.bot";

export async function runUninstallService(): Promise<void> {
  const platform = process.platform;

  if (platform === "darwin") {
    const homeDir = process.env.HOME!;
    const plistPath = resolve(homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);

    if (!existsSync(plistPath)) {
      console.log("No LaunchAgent found. Nothing to remove.");
      return;
    }

    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
    } catch {}

    unlinkSync(plistPath);
    console.log(`Removed ${plistPath}`);
    console.log("Service stopped and removed.");

  } else if (platform === "linux") {
    try {
      execSync("systemctl --user stop claude-discord 2>/dev/null", { stdio: "ignore" });
      execSync("systemctl --user disable claude-discord 2>/dev/null", { stdio: "ignore" });
    } catch {}

    const homeDir = process.env.HOME!;
    const unitPath = resolve(homeDir, ".config", "systemd", "user", "claude-discord.service");

    if (existsSync(unitPath)) {
      unlinkSync(unitPath);
      execSync("systemctl --user daemon-reload", { stdio: "ignore" });
      console.log(`Removed ${unitPath}`);
      console.log("Service stopped and removed.");
    } else {
      console.log("No systemd unit found. Nothing to remove.");
    }

  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    process.exit(1);
  }
}
