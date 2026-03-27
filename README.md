# claude-discord

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from Discord. Each channel maps to a project directory — send a message and Claude works on your codebase in a threaded session.

```
Discord Server
├─ #api-server          → ~/code/api-server
│   ├─ 🧵 Fix login bug    → session A
│   └─ 🧵 Add rate limit   → session B
├─ #frontend            → ~/code/frontend
│   └─ 🧵 Refactor Header  → session C
```

**Channel = project directory** · **Thread = task session** · Powered by [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

## Features

- **Auto-sync channels** — watches a directory for project folders, automatically creates/removes Discord channels
- **Thread-based sessions** — each thread maintains its own Claude session context
- **Background service** — install as a macOS LaunchAgent or Linux systemd service
- **Full Claude Code capabilities** — file read/write, bash execution, git, MCP servers

## Quick Start

```bash
npm install -g claude-discord
claude-discord init
claude-discord start
```

## Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude login`)
- A Discord bot token ([create one here](https://discord.com/developers/applications))

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it
3. Go to **Bot**:
   - Enable **Message Content Intent**
4. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Send Messages in Threads`, `Create Public Threads`, `Read Message History`, `View Channels`, `Manage Channels`
5. Open the generated URL to invite the bot to your server
6. Copy the bot token from the **Bot** page

### 2. Initialize

```bash
claude-discord init
```

This will ask for:
- **Discord Bot Token** — from step 1
- **Guild (Server) ID** — right-click your server name → Copy Server ID
- **Projects directory** — the folder containing your project directories (e.g. `~/Documents/code`)

Config is saved to `~/.claude-discord/.env`.

### 3. Start

```bash
# Foreground (for testing)
claude-discord start

# Or install as a background service
claude-discord install-service
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `claude-discord init` | Interactive setup wizard |
| `claude-discord start` | Start the bot (foreground) |
| `claude-discord install-service` | Install as background service (macOS/Linux) |
| `claude-discord uninstall-service` | Remove background service |
| `claude-discord status` | Show config and service status |

Options:
- `-c, --config <path>` — custom config path (default: `~/.claude-discord/.env`)

## How It Works

### Auto Channel Sync

When `WATCH_DIR` and `GUILD_ID` are set, the bot:

1. Scans the directory for project folders on startup
2. Creates a Discord channel for each project under a "Projects" category
3. Watches for new/deleted folders and syncs channels automatically

### Using in Discord

**Start a task** — send a message in a project channel:

```
Fix the /api/login endpoint returning 500
```

The bot creates a thread and runs Claude Code in the project directory. Continue the conversation in the thread — the session persists.

**Manual commands** (in any channel):

| Command | Description |
|---------|-------------|
| `/bind <path>` | Bind channel to a project directory |
| `/unbind` | Remove channel binding |
| `/projects` | List all bound projects |

## Configuration

Environment variables in `~/.claude-discord/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `GUILD_ID` | Yes | Discord server ID |
| `WATCH_DIR` | Yes | Directory to watch for projects |
| `CATEGORY_ID` | No | Discord category for project channels (auto-created if empty) |
| `ANTHROPIC_API_KEY` | No | Not needed if using `claude login` |
| `CHANNEL_PROJECTS` | No | Additional manual channel bindings (JSON) |

## Background Service

### macOS (LaunchAgent)

```bash
claude-discord install-service
```

- Auto-starts on login
- Restarts on crash (10s throttle)
- Logs: `~/.claude-discord/logs/`

### Linux (systemd)

```bash
claude-discord install-service
```

- Enabled as a user service
- Logs: `journalctl --user -u claude-discord -f`

## Project Structure

```
src/
├── cli.ts              # CLI entry point
├── commands/
│   ├── init.ts         # Setup wizard
│   ├── start.ts        # Foreground start
│   ├── install-service.ts
│   ├── uninstall-service.ts
│   └── status.ts
├── index.ts            # Legacy entry (npm run dev)
├── bot.ts              # Discord event handlers
├── agent.ts            # Claude Agent SDK wrapper
├── config.ts           # Config loading
└── watcher.ts          # Directory watcher + channel sync
```

## Development

```bash
git clone https://github.com/ryan941/claude-discord.git
cd claude-discord
npm install
cp .env.example .env    # Edit with your values
npm run dev
```

## License

MIT
