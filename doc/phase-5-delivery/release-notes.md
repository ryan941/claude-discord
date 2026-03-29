# Release Notes

---

# v1.3.0: Interactive Permission Confirmation

## Overview

The bot now respects Claude Code's **built-in permission system**. When the SDK determines that a tool requires user approval (e.g., `git push`, destructive file operations), the bot sends an interactive **Allow/Deny** button in the thread. The user clicks to approve or reject — no more blind `bypassPermissions`.

The permission logic is identical to terminal Claude Code (`permissionMode: "default"`). Low-risk operations (Read, Glob, Grep) execute automatically; high-risk operations prompt for confirmation.

---

## New Features

### Permission Confirmation Buttons

When Claude tries to execute a tool that requires permission:

**Discord:**
```
🔒 **Permission Required**
Tool: **Bash**
Running `git push origin main`
Reason: This command may modify remote repository

[✅ Allow]  [❌ Deny]
```

**Slack:**
Same layout using Block Kit buttons (primary/danger styles).

### Timeout & Recovery

- If you don't respond within **60 seconds**, the operation is automatically **denied** (fail-safe)
- The agent stops and tells you it needs permission
- **Resume anytime**: just reply in the same thread (e.g., "go ahead") — the agent picks up where it left off via session resume and will re-prompt for permission

### Button States

After clicking or timeout, the button message updates:
- `✅ Allowed: Bash — Running \`git push origin main\``
- `❌ Denied: Bash — Running \`git push origin main\``
- `⏰ Timed out: Bash — Running \`git push origin main\``

---

## Behavior Change

**`permissionMode` changed from `bypassPermissions` to `default`.**

Previously, all tool calls executed without any approval. Now, the SDK dynamically determines which tools need permission — the same logic used in terminal Claude Code. Most operations still execute automatically; only potentially destructive ones trigger the confirmation prompt.

---

## Configuration

**No new environment variables or bot scopes required.** Discord Button interactions and Slack Block Kit actions work with existing permissions.

---

## Backward Compatibility

**Fully backward compatible:**

- If `runAgent()` is called without a `permissionHandler` (e.g., from tests), it falls back to `bypassPermissions` mode automatically
- `skills.ts` and `config.ts` were **not modified**
- Existing verbosity modes, emoji reactions, and all other features continue to work unchanged

---

## Architecture Changes

- `agent.ts`: `runAgent()` accepts optional `permissionHandler` callback; `summarizeToolUse()` now exported for reuse
- `platforms/types.ts`: New `PermissionHandler` type (aligns with SDK's `CanUseTool` signature)
- `platforms/utils.ts`: `handleAgentRun()` threads `permissionHandler` to `runAgent()`
- `platforms/discord/bot.ts`: `createDiscordPermissionHandler()` — closure over `ThreadChannel`, uses `awaitMessageComponent()`
- `platforms/slack/bot.ts`: `createSlackPermissionHandler()` + `pendingPermissions` Map + `app.action()` regex handler for Promise bridging

---

## Dependencies

No new dependencies. No new bot scopes required.

---

---

# v1.2.0: Verbosity Modes & Emoji Reactions

## Overview

This release introduces **Verbosity Modes** — per-channel control over how much progress information the bot displays during agent execution. Three modes are available: **quiet** (result only), **normal** (single updating progress message), and **verbose** (individual messages per tool call, matching v1.1.0 behavior). Additionally, the bot now shows **emoji reactions** (⏳/✅/❌) on user messages to indicate agent execution status at a glance.

---

## New Features

### Verbosity Modes

Control how progress messages appear in your channel:

| Mode | Progress Behavior | When to Use |
|------|-------------------|-------------|
| **quiet** | No progress messages — only the final result | When you just want the answer |
| **normal** (default) | One progress message, updated in place | Daily use — clean threads |
| **verbose** | Each tool call as a separate message (v1.1.0 behavior) | Debugging — see every step |

Switch modes with these commands in any bound channel (not in threads):

```
/quiet      # Only show final result
/normal     # Single updating progress message (default)
/verbose    # Every tool call as separate message
```

The bot confirms the change: `Verbosity set to **normal**`

The setting is **per-channel** and resets to `normal` on bot restart.

### Emoji Reaction Status

The bot now adds emoji reactions to your message to indicate execution status:

- ⏳ — Agent is processing your request
- ✅ — Agent completed successfully (replaces ⏳)
- ❌ — Agent encountered an error (replaces ⏳)

This works in **all verbosity modes**, so even in `quiet` mode you can see at a glance whether the bot is still working.

If the bot lacks permission to add reactions (e.g., missing Slack scope), it silently skips reactions without affecting agent execution.

---

## Behavior Change

**Default progress behavior changed from `verbose` to `normal`.**

In v1.1.0, every tool call produced a separate message in the thread (what is now called `verbose` mode). Starting in v1.2.0, the default is `normal` mode — progress is shown in a single message that updates in place.

To restore v1.1.0 behavior, run `/verbose` in the channel.

---

## Configuration

### Slack: New Bot Scope Required

To enable emoji reactions on Slack, add the `reactions:write` scope to your Slack App:

1. Go to https://api.slack.com/apps → your app → **OAuth & Permissions**
2. Under **Bot Token Scopes**, add `reactions:write`
3. Reinstall the app to your workspace

If this scope is not added, the bot still works normally — emoji reactions are silently skipped.

**Updated Slack scope list:**

| Scope | Purpose | Required |
|-------|---------|----------|
| `chat:write` | Send and edit messages | Yes |
| `channels:read` | Read channel info | Yes |
| `channels:history` | Read message history | Yes |
| `reactions:write` | Add/remove emoji reactions | Recommended |
| `channels:manage` | Auto-sync channels (WATCH_DIR) | Optional |
| `channels:join` | Join channels for auto-sync | Optional |

### No New Environment Variables

Verbosity is controlled at runtime via chat commands, not environment variables. No `.env` changes needed.

---

## Backward Compatibility

**Fully backward compatible.** All existing functionality continues to work:

- `agent.ts`, `skills.ts`, and `config.ts` were **not modified**
- Existing channel bindings, skills, and session management are unchanged
- The only visible change is the default progress behavior (now `normal` instead of `verbose`)
- Run `/verbose` to restore v1.1.0 behavior in any channel

---

## Architecture Changes

The `ChatChannel` interface was extended with new capabilities:

```typescript
interface ChatChannel {
  send(text: string): Promise<string | undefined>;  // Now returns message ID
  sendTyping(): void;
  edit(messageId: string, text: string): Promise<void>;      // NEW
  react(messageId: string, emoji: string): Promise<void>;     // NEW
  removeReact(messageId: string, emoji: string): Promise<void>; // NEW
}
```

`createProgressSender()` now accepts a `verbosity` parameter to control its behavior. `handleAgentRun()` accepts `verbosity` and `userMessageId` for reaction lifecycle management.

Core modules `agent.ts` and `skills.ts` remain **unmodified**.

---

## Dependencies

| Package | Change | Version |
|---------|--------|---------|
| `@slack/bolt` | Unchanged | ^4.1.0 |
| `discord.js` | Unchanged | ^14.25.1 |
| `@anthropic-ai/claude-agent-sdk` | Unchanged | ^0.2.76 |
| `dotenv` | Unchanged | ^17.3.1 |

No new dependencies added.

---

---

# v1.1.0: Slack Platform Support

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
