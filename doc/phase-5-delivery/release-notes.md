# Release Notes — v1.1.0: Slack Platform Support

## Overview

claude-discord now supports **Slack** as a second platform alongside Discord. The architecture has been refactored into a platform adapter pattern, allowing both bots to run simultaneously from a single process with shared configuration.

---

## New Features

### Slack Bot (Socket Mode)
- Send messages in a bound Slack channel to trigger Claude Code sessions
- Thread-based conversations with persistent session context
- Real-time streaming progress (tool usage, thinking indicators)
- Skill system support (`/skillname args` in Slack messages)
- Admin commands: `/bind`, `/unbind`, `/projects`, `/skills`

### Slack Auto-Sync (WATCH_DIR)
- Automatically creates Slack channels for project directories (prefixed `claude-`)
- Archives channels when project directories are removed
- File system watcher with 2s debounce for live directory changes

### Multi-Platform Support
- Run Discord and Slack bots simultaneously from one process
- Platform selection via CLI: `claude-discord start --platform discord|slack|all`
- Shared agent and skill system across platforms
- `claude-discord init` wizard now includes Slack configuration

---

## Configuration

### New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes (for Slack) | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes (for Slack) | App-Level Token (`xapp-...`) for Socket Mode |
| `SLACK_CHANNEL_PROJECTS` | No | Manual channel bindings (JSON, same format as `CHANNEL_PROJECTS`) |

At least one platform (Discord or Slack) must be configured. Both can be active at the same time.

### Slack App Setup

1. Create a Slack App at https://api.slack.com/apps
2. Enable **Socket Mode** (requires App-Level Token)
3. Subscribe to the `message.channels` bot event
4. Required bot scopes: `chat:write`, `channels:read`, `channels:history`
5. For auto-sync: also add `channels:manage`, `channels:join`
6. Install the app to your workspace

### CLI Changes

```
claude-discord start                     # Start all configured platforms (default)
claude-discord start --platform discord  # Discord only
claude-discord start --platform slack    # Slack only
claude-discord start -p slack            # Short form
```

---

## Backward Compatibility

**Fully backward compatible.** Existing Discord-only setups work without any changes:

- If only `DISCORD_TOKEN` is set, behavior is identical to v1.0.4
- No configuration migration needed
- `npm run dev` still works as before
- Service installations (LaunchAgent/systemd) continue to work

---

## Architecture Changes

The codebase was refactored from a Discord-specific structure to a platform adapter pattern:

- `src/platforms/types.ts` — Shared `ChatChannel`, `ReplyHandler`, `PlatformAdapter` interfaces
- `src/platforms/utils.ts` — Platform-agnostic shared logic (message splitting, progress reporting, agent execution)
- `src/platforms/discord/` — Discord adapter (refactored from original `bot.ts` and `watcher.ts`)
- `src/platforms/slack/` — Slack adapter (new)

Core modules `agent.ts` and `skills.ts` were **not modified** — they remain platform-agnostic.

---

## Known Limitations

- **Slack `/skills` in threads**: The `/skills` command only works in top-level channel messages, not inside threads. Use it in the main channel instead.
- **Slack typing indicator**: Slack does not have a persistent typing indicator API equivalent to Discord's, so no typing animation is shown during processing.
- **Slack Slash Command conflicts**: Do not register native Slack Slash Commands with the same names as skill commands (e.g., `/pm`, `/bind`). The bot uses plain text matching, which works as long as no native command intercepts the message.
- **Channel name prefix**: Auto-synced Slack channels are prefixed with `claude-` (e.g., `claude-my-project`) to avoid conflicts with existing channels.

---

## Dependencies

| Package | Change | Version |
|---------|--------|---------|
| `@slack/bolt` | **Added** | ^4.1.0 |
| `discord.js` | Unchanged | ^14.25.1 |
| `@anthropic-ai/claude-agent-sdk` | Unchanged | ^0.2.76 |
| `dotenv` | Unchanged | ^17.3.1 |
