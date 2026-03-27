import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";

const SERVICE_LABEL = "com.claude-discord.bot";

function getNodePath(): string {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return "/usr/local/bin/node";
  }
}

function getEntryPoint(): string {
  // When installed globally via npm, __dirname points to dist/commands/
  // The start command is at dist/cli.js
  return resolve(__dirname, "..", "cli.js");
}

function generateLaunchAgentPlist(configPath: string): string {
  const nodePath = getNodePath();
  const entryPoint = getEntryPoint();
  const homeDir = process.env.HOME || "~";
  const logDir = resolve(homeDir, ".claude-discord", "logs");

  mkdirSync(logDir, { recursive: true });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${entryPoint}</string>
        <string>start</string>
        <string>-c</string>
        <string>${configPath}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${logDir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${logDir}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${dirname(nodePath)}</string>
    </dict>
</dict>
</plist>`;
}

function generateSystemdUnit(configPath: string): string {
  const nodePath = getNodePath();
  const entryPoint = getEntryPoint();
  const user = process.env.USER || "root";

  return `[Unit]
Description=claude-discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
ExecStart=${nodePath} ${entryPoint} start -c ${configPath}
Restart=on-failure
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
}

export async function runInstallService(configPath: string): Promise<void> {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS: LaunchAgent
    const homeDir = process.env.HOME!;
    const plistPath = resolve(homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
    const plistContent = generateLaunchAgentPlist(configPath);

    // Unload if already loaded
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
    } catch {}

    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, plistContent, "utf-8");
    console.log(`LaunchAgent written to ${plistPath}`);

    execSync(`launchctl load "${plistPath}"`);
    console.log("Service started. It will auto-start on login.");
    console.log(`\nLogs: ~/.claude-discord/logs/`);
    console.log(`Stop:  launchctl unload "${plistPath}"`);
    console.log(`Start: launchctl load "${plistPath}"`);

  } else if (platform === "linux") {
    // Linux: systemd user service
    const homeDir = process.env.HOME!;
    const unitDir = resolve(homeDir, ".config", "systemd", "user");
    const unitPath = resolve(unitDir, "claude-discord.service");
    const unitContent = generateSystemdUnit(configPath);

    mkdirSync(unitDir, { recursive: true });
    writeFileSync(unitPath, unitContent, "utf-8");
    console.log(`Systemd unit written to ${unitPath}`);

    try {
      execSync("systemctl --user daemon-reload");
      execSync("systemctl --user enable claude-discord");
      execSync("systemctl --user start claude-discord");
      console.log("Service started and enabled on boot.");
      console.log("\nUseful commands:");
      console.log("  systemctl --user status claude-discord");
      console.log("  systemctl --user stop claude-discord");
      console.log("  journalctl --user -u claude-discord -f");
    } catch (err) {
      console.error("Failed to start systemd service. You may need to run manually:");
      console.error("  systemctl --user daemon-reload");
      console.error("  systemctl --user enable --now claude-discord");
    }

  } else {
    console.error(`Unsupported platform: ${platform}`);
    console.error('On Windows, use "claude-discord start" with a task scheduler or pm2.');
    process.exit(1);
  }
}
