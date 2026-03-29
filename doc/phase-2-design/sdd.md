# SDD 系統設計文件 — Slack 平台擴充

## 文件資訊

| 項目 | 內容 |
|------|------|
| 版本 | v3.0（v2.0 + Verbosity Modes） |
| 建立日期 | 2026-03-27 |
| 狀態 | 草稿 |

---

## 1. 架構概覽

### 1.1 設計原則

- **最小抽象**：只抽象必要的平台差異（訊息收發），不強行統一事件模型
- **向後相容**：只有 Discord token 時，行為與 v1.0.4 完全一致
- **對稱結構**：Discord adapter 和 Slack adapter 結構對稱，降低認知負擔
- **不動核心**：agent.ts 和 skills.ts 零修改

### 1.2 模組關係圖

```
┌─────────────────────────────────────────────────┐
│                    CLI (cli.ts)                  │
│              start [--platform X]                │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│              Config (config.ts)                  │
│         loadConfig() → AppConfig                 │
│    { discord?: DiscordConfig, slack?: SlackConfig}│
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│              Startup (index.ts)                  │
│    for each configured platform → create adapter │
│    adapter.start()                               │
└───────┬──────────────────────────────┬──────────┘
        │                              │
┌───────┴───────┐              ┌───────┴───────┐
│   Discord     │              │    Slack      │
│   Adapter     │              │    Adapter    │
│  ┌─────────┐  │              │  ┌─────────┐  │
│  │  bot.ts │  │              │  │  bot.ts │  │
│  └────┬────┘  │              │  └────┬────┘  │
│  ┌────┴────┐  │              │  ┌────┴────┐  │
│  │watcher  │  │              │  │watcher  │  │
│  └─────────┘  │              │  └─────────┘  │
└───────┬───────┘              └───────┬───────┘
        │                              │
        └──────────┬───────────────────┘
                   │ (ChatChannel interface)
┌──────────────────┴──────────────────────────────┐
│           Shared Utils (platforms/utils.ts)       │
│  splitMessage() · createProgressSender()         │
│  handleAgentRun()                                │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────┴───────┐     ┌───────┴───────┐
│   agent.ts    │     │   skills.ts   │
│  (不修改)     │     │   (不修改)    │
│  runAgent()   │     │  resolveSkill │
└───────────────┘     └───────────────┘
```

---

## 2. 檔案結構

### 2.1 完整目標結構

```
src/
├── platforms/
│   ├── types.ts              # 共用介面定義
│   ├── utils.ts              # 平台無關的共用邏輯
│   ├── discord/
│   │   ├── bot.ts            # Discord adapter（重構自 src/bot.ts）
│   │   └── watcher.ts        # Discord watcher（搬自 src/watcher.ts）
│   └── slack/
│       ├── bot.ts            # Slack adapter（新增）
│       └── watcher.ts        # Slack watcher（新增）
├── agent.ts                  # 不修改
├── skills.ts                 # 不修改
├── config.ts                 # 擴充
├── cli.ts                    # 擴充
├── index.ts                  # 重寫（多平台啟動）
└── commands/
    ├── init.ts               # 擴充（Slack 設定）
    ├── start.ts              # 擴充（--platform 參數）
    ├── install-service.ts    # 不修改
    ├── uninstall-service.ts  # 不修改
    └── status.ts             # 擴充（顯示 Slack 狀態）
```

### 2.2 變更矩陣

| 檔案 | 動作 | 說明 |
|------|------|------|
| src/bot.ts | **刪除** | 邏輯拆分到 platforms/utils.ts + platforms/discord/bot.ts |
| src/watcher.ts | **刪除** | 搬到 platforms/discord/watcher.ts |
| src/platforms/types.ts | **新增** | 共用介面 |
| src/platforms/utils.ts | **新增** | 共用邏輯 |
| src/platforms/discord/bot.ts | **新增** | Discord adapter |
| src/platforms/discord/watcher.ts | **新增** | Discord watcher |
| src/platforms/slack/bot.ts | **新增** | Slack adapter |
| src/platforms/slack/watcher.ts | **新增** | Slack watcher |
| src/config.ts | **修改** | 多平台設定 |
| src/index.ts | **修改** | 多平台啟動 |
| src/cli.ts | **修改** | --platform 參數 |
| src/commands/init.ts | **修改** | Slack 設定流程 |
| src/commands/start.ts | **修改** | 傳遞 platform 參數 |
| src/commands/status.ts | **修改** | 顯示 Slack 連線狀態 |
| src/agent.ts | **不動** | — |
| src/skills.ts | **不動** | — |

---

## 3. 介面定義

### 3.1 platforms/types.ts — 共用介面

```typescript
/**
 * 平台無關的訊息通道抽象。
 * Discord 的 TextChannel/ThreadChannel 和 Slack 的 channel/thread
 * 都透過此介面與共用邏輯互動。
 */
export interface ChatChannel {
  /** 發送訊息到此通道 */
  send(text: string): Promise<void>;
  /** 顯示 typing indicator（平台支援的話） */
  sendTyping(): void;
}

/**
 * 平台 adapter 的生命週期介面。
 * 每個平台（Discord、Slack）實作此介面。
 */
export interface PlatformAdapter {
  readonly name: string;  // "discord" | "slack"
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * handleAgentRun 的回呼介面，用於平台特定的回覆行為。
 */
export interface ReplyHandler {
  /** 發送最終結果的 chunk。第一次呼叫可能是 reply（引用回覆），後續是普通 send */
  sendResult(chunk: string, isFirst: boolean): Promise<void>;
  /** 發送錯誤訊息 */
  sendError(errorMsg: string): Promise<void>;
}
```

### 3.2 platforms/utils.ts — 共用邏輯

從現有 bot.ts 提取，改為參數化：

```typescript
/**
 * 將長文字拆分為多段，不超過指定長度。
 * 優先在換行處斷開。
 */
export function splitMessage(text: string, limit: number): string[];

/**
 * Debounced progress sender，合併連續同類型工具事件。
 * 接受 ChatChannel 而非 Discord 特定 channel。
 */
export function createProgressSender(
  channel: ChatChannel,
  msgLimit: number
): ProgressSender;

interface ProgressSender {
  pushTool(tool: string, summary: string): void;
  push(line: string): void;
  finish(): Promise<void>;
}

/**
 * 平台無關的 agent 執行流程。
 * 處理 typing indicator、streaming progress、最終結果發送。
 */
export async function handleAgentRun(
  channel: ChatChannel,
  prompt: string,
  cwd: string,
  threadId: string,
  reply: ReplyHandler,
  msgLimit: number,
): Promise<void>;
```

**handleAgentRun 的完整邏輯**（從 bot.ts 提取）：
1. 呼叫 `channel.sendTyping()` 開始 typing（各平台自行決定如何 refresh）
2. 建立 `createProgressSender(channel, msgLimit)` 開始進度回報
3. 設定 StreamCallbacks（onToolUse → progress.pushTool, onText → buffer + debounce flush）
4. 呼叫 `runAgent(prompt, cwd, threadId, callbacks)`
5. 完成後用 `reply.sendResult()` 發送結果 chunks
6. 錯誤時用 `reply.sendError()` 發送錯誤

### 3.3 config.ts — 多平台設定

```typescript
export interface DiscordConfig {
  token: string;
  guildId?: string;
  categoryId?: string;
  channelProjects: Map<string, string>;
}

export interface SlackConfig {
  botToken: string;   // xoxb-...
  appToken: string;   // xapp-...
  channelProjects: Map<string, string>;
}

export interface AppConfig {
  discord?: DiscordConfig;   // undefined = Discord 未設定
  slack?: SlackConfig;       // undefined = Slack 未設定
  watchDir?: string;         // 共用，兩個平台各自 sync
}

export function loadConfig(): AppConfig;
```

**環境變數對照**：

| 環境變數 | 對應 | 必填 |
|---------|------|------|
| `DISCORD_TOKEN` | discord.token | 至少一個平台必填 |
| `GUILD_ID` | discord.guildId | Discord auto-sync 需要 |
| `CATEGORY_ID` | discord.categoryId | 選填 |
| `CHANNEL_PROJECTS` | discord.channelProjects | 選填 |
| `SLACK_BOT_TOKEN` | slack.botToken | 至少一個平台必填 |
| `SLACK_APP_TOKEN` | slack.appToken | Slack 必填 |
| `SLACK_CHANNEL_PROJECTS` | slack.channelProjects | 選填 |
| `WATCH_DIR` | watchDir | 選填 |

**向後相容**：`loadConfig()` 不再 throw（原本 Discord token 缺少就 throw）。改為：至少一個平台有 token 就通過，全部沒有才 throw。

---

## 4. 模組詳細設計

### 4.1 platforms/discord/bot.ts — Discord Adapter

**來源**：從 src/bot.ts 搬移並重構

**匯出**：
```typescript
export function createDiscordAdapter(
  config: DiscordConfig,
  watchDir?: string
): PlatformAdapter;
```

**內部結構**：
- 建立 discord.js Client（與現有 createBot 相同）
- `clientReady` 事件：preload skills、啟動 watcher
- `messageCreate` 事件：admin 指令、thread 建立、session 續接
- 使用 `handleAgentRun()` from utils.ts（替代原本內嵌的邏輯）
- 將 Discord 的 TextChannel/ThreadChannel 包裝為 ChatChannel：
  ```typescript
  function wrapDiscordChannel(ch: TextChannel | ThreadChannel): ChatChannel {
    let typingAlive = true;
    const tick = () => {
      if (!typingAlive) return;
      ch.sendTyping().catch(() => {});
      setTimeout(tick, 8000);
    };
    return {
      send: (text) => ch.send(text).then(() => {}),
      sendTyping: () => { typingAlive = true; tick(); },
      // stopTyping exposed via closure
    };
  }
  ```

**Discord 特定常數**：`MSG_LIMIT = 2000`

### 4.2 platforms/discord/watcher.ts — Discord Watcher

**來源**：從 src/watcher.ts 直接搬移，無邏輯變更

**匯出**：
```typescript
export function syncProjects(client: Client, config: DiscordConfig, watchDir: string): Promise<void>;
export function startWatcher(client: Client, config: DiscordConfig, watchDir: string): void;
```

唯一變更：接受 `DiscordConfig` 而非 `BotConfig`。

### 4.3 platforms/slack/bot.ts — Slack Adapter

**新增檔案**，與 Discord adapter 結構對稱。

**匯出**：
```typescript
export function createSlackAdapter(
  config: SlackConfig,
  watchDir?: string
): PlatformAdapter;
```

**內部結構**：

```typescript
import { App } from "@slack/bolt";

export function createSlackAdapter(config: SlackConfig, watchDir?: string): PlatformAdapter {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
  });

  // Listen to ALL messages (no pattern filter)
  app.message(async ({ message, say, client }) => {
    // 1. Filter: ignore bot messages
    if (message.subtype === "bot_message" || "bot_id" in message) return;

    const text = "text" in message ? message.text || "" : "";
    const channelId = message.channel;
    const threadTs = "thread_ts" in message ? message.thread_ts : undefined;

    // 2. Admin commands (non-thread only)
    if (!threadTs) {
      if (text.startsWith("/bind ")) { /* bind logic */ return; }
      if (text === "/unbind") { /* unbind logic */ return; }
      if (text === "/projects") { /* list projects */ return; }
      if (text === "/skills") { /* list skills */ return; }
    }

    // 3. Resolve project
    const cwd = config.channelProjects.get(channelId);
    if (!cwd) return;

    // 4. Resolve skill
    const skill = resolveSkill(text, cwd);
    const prompt = skill ? buildSkillPrompt(skill, text) : text;

    // 5. Determine thread context
    const sessionKey = threadTs || message.ts;  // thread parent ts or message ts

    // 6. Wrap Slack channel as ChatChannel
    const chatChannel: ChatChannel = {
      send: async (t) => {
        await client.chat.postMessage({
          channel: channelId,
          text: t,
          thread_ts: threadTs || message.ts,
        });
      },
      sendTyping: () => {
        // Slack has no persistent typing; noop or one-shot indicator
      },
    };

    // 7. Reply handler
    const reply: ReplyHandler = {
      sendResult: async (chunk, isFirst) => {
        await client.chat.postMessage({
          channel: channelId,
          text: chunk,
          thread_ts: threadTs || message.ts,
        });
      },
      sendError: async (errMsg) => {
        await client.chat.postMessage({
          channel: channelId,
          text: `Agent error: ${errMsg}`,
          thread_ts: threadTs || message.ts,
        });
      },
    };

    // 8. Notify skill loaded
    if (skill) {
      await chatChannel.send(`> Loaded skill: *${skill.name}*`);
    }

    // 9. Run agent
    await handleAgentRun(chatChannel, prompt, cwd, sessionKey, reply, SLACK_MSG_LIMIT);
  });

  return {
    name: "slack",
    async start() {
      await app.start();
      console.log("[slack] Bot online (Socket Mode)");
      // Preload skills + start watcher
      for (const [, cwd] of config.channelProjects) {
        preloadSkills(cwd);
      }
      if (watchDir) {
        syncSlackProjects(app, config, watchDir);
        startSlackWatcher(app, config, watchDir);
      }
    },
    async stop() {
      await app.stop();
    },
  };
}
```

**Slack 特定常數**：`SLACK_MSG_LIMIT = 4000`（保守值，Slack 上限 40,000 但過長訊息 UX 差）

**Slack vs Discord 差異表**：

| 行為 | Discord | Slack |
|------|---------|-------|
| 建立 thread | `message.startThread()` | 自動（reply with `thread_ts` = message.ts） |
| Typing indicator | `channel.sendTyping()`，每 8s refresh | Slack 無等效 API，noop |
| Thread ID | `thread.id`（string） | `message.ts`（timestamp string） |
| Is-in-thread 判斷 | `channel.isThread()` | `message.thread_ts` 存在 |
| Reply（引用） | `message.reply(text)` | `chat.postMessage` with `thread_ts` |
| 格式化 | Markdown（`**bold**`、`` `code` ``） | Mrkdwn（`*bold*`、`` `code` ``） |

### 4.4 platforms/slack/watcher.ts — Slack Watcher

**新增檔案**，邏輯與 Discord watcher 對稱。

**匯出**：
```typescript
export function syncSlackProjects(app: App, config: SlackConfig, watchDir: string): Promise<void>;
export function startSlackWatcher(app: App, config: SlackConfig, watchDir: string): void;
```

**差異**：
- 使用 `app.client.conversations.create({ name })` 建立頻道（非 guild.channels.create）
- 使用 `app.client.conversations.archive({ channel })` 歸檔頻道（非 channel.delete）
- 無 category 概念（Slack 沒有 channel category）
- 頻道名稱前綴 `claude-` 避免與既有頻道衝突
- 使用 `app.client.conversations.list()` 檢查頻道是否存在
- 共用 `listProjectDirs()` 和 `IGNORE_DIRS`（提取到 platforms/utils.ts）

### 4.5 config.ts — 多平台設定

**修改重點**：

```typescript
export function loadConfig(): AppConfig {
  const discord: DiscordConfig | undefined = process.env.DISCORD_TOKEN
    ? {
        token: process.env.DISCORD_TOKEN,
        guildId: process.env.GUILD_ID,
        categoryId: process.env.CATEGORY_ID,
        channelProjects: parseChannelProjects(process.env.CHANNEL_PROJECTS),
      }
    : undefined;

  const slack: SlackConfig | undefined =
    process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN
      ? {
          botToken: process.env.SLACK_BOT_TOKEN,
          appToken: process.env.SLACK_APP_TOKEN,
          channelProjects: parseChannelProjects(process.env.SLACK_CHANNEL_PROJECTS),
        }
      : undefined;

  if (!discord && !slack) {
    throw new Error("At least one platform must be configured (DISCORD_TOKEN or SLACK_BOT_TOKEN + SLACK_APP_TOKEN)");
  }

  return {
    discord,
    slack,
    watchDir: process.env.WATCH_DIR,
  };
}
```

### 4.6 index.ts — 多平台啟動

```typescript
import { loadConfig } from "./config";
import { createDiscordAdapter } from "./platforms/discord/bot";
import { createSlackAdapter } from "./platforms/slack/bot";
import { PlatformAdapter } from "./platforms/types";

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

  // Start all adapters concurrently
  await Promise.all(adapters.map((a) => a.start()));

  console.log(`Running platforms: ${adapters.map((a) => a.name).join(", ")}`);
  return adapters;
}
```

### 4.7 cli.ts — --platform 參數

新增 `--platform` 選項，傳遞到 `runStart`：

```
claude-discord start                    # 啟動所有已設定的平台
claude-discord start --platform discord # 只啟動 Discord
claude-discord start --platform slack   # 只啟動 Slack
```

解析邏輯在 cli.ts 的 start case 中加入 `--platform` 參數提取。

### 4.8 commands/init.ts — Slack 設定

在現有設定流程後新增：

```
=== Slack Configuration (optional) ===
Slack Bot Token (xoxb-...): [留空跳過]
Slack App Token (xapp-...): [留空跳過]
```

寫入 .env 的新增行：
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_PROJECTS={}
```

---

## 5. 共用邏輯提取清單

從現有 bot.ts 提取到 platforms/utils.ts 的函式：

| 函式 | 原位置 | 變更 |
|------|--------|------|
| `splitMessage(text, limit)` | bot.ts:17-38 | 新增 `limit` 參數（原本硬編碼 2000） |
| `createProgressSender(channel, msgLimit)` | bot.ts:62-141 | `channel` 改為 `ChatChannel` 型別；`msgLimit` 參數化 |
| `handleAgentRun(channel, prompt, cwd, threadId, reply, msgLimit)` | bot.ts:144-233 | 拆出 `ReplyHandler` 介面處理平台特定的回覆邏輯 |

從現有 watcher.ts 提取到 platforms/utils.ts 的函式：

| 函式 | 原位置 | 變更 |
|------|--------|------|
| `listProjectDirs(watchDir)` | watcher.ts:25-36 | 不變，供 Discord/Slack watcher 共用 |
| `projectToChannelName(name)` | watcher.ts:38-41 | 不變 |
| `IGNORE_DIRS` | watcher.ts:11-18 | 不變 |

---

## 6. .env.example 更新

```env
# === Discord (optional — at least one platform required) ===
DISCORD_TOKEN=
GUILD_ID=
CATEGORY_ID=
CHANNEL_PROJECTS={}

# === Slack (optional — at least one platform required) ===
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=

# === Shared ===
WATCH_DIR=
# ANTHROPIC_API_KEY=   # Only if not using `claude login`
```

---

## 7. 依賴變更

| 套件 | 動作 | 版本 |
|------|------|------|
| @slack/bolt | **新增** | ^4.1.0 |
| discord.js | 不變 | ^14.25.1 |
| @anthropic-ai/claude-agent-sdk | 不變 | ^0.2.76 |
| dotenv | 不變 | ^17.3.1 |

---

## 8. 關鍵流程序列

### 8.1 多平台啟動

```
User: claude-discord start
  → cli.ts: parse --platform (default "all")
  → commands/start.ts: loadConfig() + startAll(platform)
  → index.ts startAll():
       config.discord exists? → createDiscordAdapter() → adapter.start()
         → discord.js Client login
         → syncProjects + startWatcher
       config.slack exists? → createSlackAdapter() → adapter.start()
         → Bolt app.start() (Socket Mode)
         → syncSlackProjects + startSlackWatcher
  → console: "Running platforms: discord, slack"
```

### 8.2 Slack 訊息處理（新功能）

```
Slack User: sends "refactor the auth module" in #my-project
  → Bolt app.message() handler
  → Filter: not bot, not admin command
  → channelProjects.get(channelId) → cwd = "/path/to/my-project"
  → resolveSkill("refactor the auth module", cwd) → null
  → sessionKey = message.ts (new thread)
  → wrapSlackChannel() → ChatChannel
  → handleAgentRun(chatChannel, prompt, cwd, sessionKey, reply, 4000)
    → runAgent(prompt, cwd, sessionKey, callbacks)
    → callbacks.onToolUse → progress.pushTool → channel.send (in thread)
    → result → reply.sendResult(chunk) → chat.postMessage(thread_ts)
```

### 8.3 向後相容驗證

```
User: 只有 DISCORD_TOKEN，無 SLACK_*
  → loadConfig(): discord = {...}, slack = undefined
  → startAll("all"): only createDiscordAdapter()
  → 行為與 v1.0.4 完全相同 ✅
```

---

## 9. Verbosity Modes 設計（v3.0 新增）

### 9.1 設計概覽

Verbosity Modes 在現有的 progress sender 機制上加入分支邏輯，控制進度訊息的顯示策略。搭配 emoji reaction 在使用者訊息上指示 agent 執行狀態。

**影響範圍**：

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| platforms/types.ts | 修改 | ChatChannel 介面擴充 |
| platforms/utils.ts | 修改 | createProgressSender + handleAgentRun 加入 verbosity 邏輯 |
| platforms/discord/bot.ts | 修改 | wrapDiscordChannel 擴充 + verbosity 指令 + reaction |
| platforms/slack/bot.ts | 修改 | chatChannel 擴充 + verbosity 指令 + reaction |
| agent.ts | **不動** | — |
| skills.ts | **不動** | — |
| config.ts | **不動** | — |

### 9.2 types.ts 介面擴充

```typescript
// --- 新增 ---

export type VerbosityMode = "quiet" | "normal" | "verbose";

// --- 修改 ChatChannel ---

export interface ChatChannel {
  /** 發送訊息，回傳 message ID（用於後續 edit/react） */
  send(text: string): Promise<string | undefined>;

  /** 顯示 typing indicator */
  sendTyping(): void;

  /** 原地更新已發送的訊息 */
  edit(messageId: string, text: string): Promise<void>;

  /** 在指定訊息上加 emoji reaction */
  react(messageId: string, emoji: string): Promise<void>;

  /** 移除指定訊息上的 emoji reaction */
  removeReact(messageId: string, emoji: string): Promise<void>;
}

// --- ReplyHandler 不變 ---

export interface ReplyHandler {
  sendResult(chunk: string, isFirst: boolean): Promise<void>;
  sendError(errorMsg: string): Promise<void>;
}

// --- PlatformAdapter 不變 ---
```

**設計決策**：
- `send()` 回傳 `string | undefined`：Discord 和 Slack 都能從 send 回應中取得 message ID。回傳 `undefined` 表示取得失敗（不影響流程）
- `edit()`/`react()`/`removeReact()` 為必要方法（非 optional）：兩平台都支援，實作中用 try-catch 靜默處理失敗
- 不新增 `supportsEditing()` 等 capability flag：當前兩個平台都完整支援，不需要

### 9.3 createProgressSender 改造

**現有簽章**：
```typescript
function createProgressSender(channel: ChatChannel, msgLimit: number)
```

**新簽章**：
```typescript
function createProgressSender(
  channel: ChatChannel,
  msgLimit: number,
  verbosity: VerbosityMode = "normal"
)
```

**三種模式的分支邏輯**：

```typescript
export function createProgressSender(
  channel: ChatChannel,
  msgLimit: number,
  verbosity: VerbosityMode = "normal"
) {
  // --- quiet 模式：所有操作為 noop ---
  if (verbosity === "quiet") {
    return {
      pushTool(_tool: string, _summary: string) {},
      push(_line: string) {},
      async finish() {},
    };
  }

  // --- verbose 模式：現有邏輯不變（每次 flush 都 send 新訊息）---
  // --- normal 模式：第一次 send，後續 edit ---

  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingTool = "";
  let pendingLabel = "";
  let pendingFiles: string[] = [];

  // normal 模式專用：追蹤進度訊息 ID
  let progressMessageId: string | undefined;
  let isEditing = false;  // 簡單 lock 防止併發 edit

  const flushPending = () => {
    // ... 與現有邏輯完全一致 ...
  };

  const flush = async () => {
    flushPending();
    if (queue.length === 0) return;
    const lines = queue.splice(0);
    const text = lines.join("\n").slice(0, msgLimit);

    try {
      if (verbosity === "normal" && progressMessageId) {
        // normal 模式：edit-in-place
        if (isEditing) return;  // 正在更新中，跳過（下次 debounce 會帶最新內容）
        isEditing = true;
        try {
          await channel.edit(progressMessageId, text);
        } catch {
          // edit 失敗（訊息已刪除等），fallback 為 send
          progressMessageId = await channel.send(text);
        }
        isEditing = false;
      } else {
        // verbose 模式 或 normal 模式的第一次：send 新訊息
        const msgId = await channel.send(text);
        if (verbosity === "normal" && !progressMessageId) {
          progressMessageId = msgId;  // 快取第一則進度訊息的 ID
        }
      }
    } catch {}
  };

  return {
    pushTool(tool: string, summary: string) {
      // ... 與現有邏輯完全一致 ...
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { flush(); }, 1500);
    },
    push(line: string) {
      // ... 與現有邏輯完全一致 ...
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { flush(); }, 1500);
    },
    async finish() {
      if (timer) clearTimeout(timer);
      await flush();
    },
  };
}
```

**關鍵行為差異**：

| 行為 | quiet | normal | verbose |
|------|-------|--------|---------|
| pushTool / push | noop | 推入 queue | 推入 queue |
| 第一次 flush | — | `send()` + 快取 msgId | `send()` |
| 後續 flush | — | `edit(msgId)` | `send()`（新訊息）|
| edit 失敗 | — | fallback `send()` | N/A |
| finish | noop | 最後一次 flush | 最後一次 flush |

### 9.4 handleAgentRun 改造

**現有簽章**：
```typescript
async function handleAgentRun(
  channel: ChatChannel,
  prompt: string,
  cwd: string,
  threadId: string,
  reply: ReplyHandler,
  msgLimit: number,
): Promise<void>
```

**新簽章**：
```typescript
async function handleAgentRun(
  channel: ChatChannel,
  prompt: string,
  cwd: string,
  threadId: string,
  reply: ReplyHandler,
  msgLimit: number,
  verbosity: VerbosityMode = "normal",
  userMessageId?: string,  // 使用者訊息 ID，用於 reaction
): Promise<void>
```

**新增邏輯**：

```typescript
export async function handleAgentRun(
  channel: ChatChannel,
  prompt: string,
  cwd: string,
  threadId: string,
  reply: ReplyHandler,
  msgLimit: number,
  verbosity: VerbosityMode = "normal",
  userMessageId?: string,
): Promise<void> {
  channel.sendTyping();

  // --- Emoji reaction：開始處理 ---
  if (userMessageId) {
    channel.react(userMessageId, "⏳").catch(() => {});
  }

  // --- 傳入 verbosity 給 progressSender ---
  const progress = createProgressSender(channel, msgLimit, verbosity);

  // ... callbacks 邏輯與現有一致（不動）...
  // ... quiet 模式下 progressSender 自動 noop，callbacks 不需判斷 ...

  try {
    const result = await runAgent(prompt, cwd, threadId, callbacks);

    // ... 現有的 flush + result 發送邏輯 ...

    // --- Emoji reaction：完成 ---
    if (userMessageId) {
      channel.removeReact(userMessageId, "⏳").catch(() => {});
      channel.react(userMessageId, "✅").catch(() => {});
    }
  } catch (err) {
    // ... 現有的 error 處理 ...

    // --- Emoji reaction：失敗 ---
    if (userMessageId) {
      channel.removeReact(userMessageId, "⏳").catch(() => {});
      channel.react(userMessageId, "❌").catch(() => {});
    }
  }
}
```

**設計要點**：
- `userMessageId` 為 optional：向後相容，不傳就沒有 reaction
- reaction 呼叫全部用 `.catch(() => {})`：失敗靜默忽略
- callbacks 不需要感知 verbosity：progressSender 在 quiet 模式下自動 noop
- onText 的中間文字 flush 行為在三種模式下一致（都會 send 到 thread）——只有 progress 訊息受 verbosity 影響

### 9.5 Discord Adapter 改動

#### 9.5.1 Verbosity 狀態管理

在 `createDiscordAdapter` 函式內新增：

```typescript
const channelVerbosity = new Map<string, VerbosityMode>();

function getVerbosity(channelId: string): VerbosityMode {
  return channelVerbosity.get(channelId) ?? "normal";
}
```

#### 9.5.2 wrapDiscordChannel 擴充

```typescript
function wrapDiscordChannel(
  ch: TextChannel | ThreadChannel
): { channel: ChatChannel; stop: () => void } {
  let alive = true;

  const tick = () => {
    if (!alive) return;
    ch.sendTyping().catch(() => {});
    setTimeout(tick, 8000);
  };

  return {
    channel: {
      send: async (text) => {
        const msg = await ch.send(text);
        return msg.id;  // 回傳 Discord message ID
      },
      sendTyping: () => { alive = true; tick(); },
      edit: async (messageId, text) => {
        const msg = await ch.messages.fetch(messageId);
        await msg.edit(text);
      },
      react: async (messageId, emoji) => {
        const msg = await ch.messages.fetch(messageId);
        await msg.react(emoji);
      },
      removeReact: async (messageId, emoji) => {
        const msg = await ch.messages.fetch(messageId);
        const reaction = msg.reactions.cache.find(
          (r) => r.emoji.name === emoji
        );
        if (reaction) await reaction.users.remove(ch.client.user?.id);
      },
    },
    stop: () => { alive = false; },
  };
}
```

#### 9.5.3 Verbosity 指令解析

在 `messageCreate` handler 的 admin commands 區塊新增（在 `/skills` 之後）：

```typescript
// --- Admin command: /quiet, /normal, /verbose ---
const verbosityCommands: Record<string, VerbosityMode> = {
  "/quiet": "quiet",
  "/normal": "normal",
  "/verbose": "verbose",
};
if (message.content in verbosityCommands && !message.channel.isThread()) {
  const channelId = message.channel.id;
  if (!resolveProjectCwd(channelId, config)) return;  // 未綁定就忽略
  const mode = verbosityCommands[message.content];
  channelVerbosity.set(channelId, mode);
  await message.reply(`Verbosity set to **${mode}**`);
  return;
}
```

#### 9.5.4 handleAgentRun 呼叫更新

**頻道訊息（建立 thread）**：
```typescript
// 現有
await handleAgentRun(chatChannel, prompt, cwd, thread.id, reply, MSG_LIMIT);

// 改為
const verbosity = getVerbosity(message.channel.id);
await handleAgentRun(chatChannel, prompt, cwd, thread.id, reply, MSG_LIMIT, verbosity, message.id);
```

**Thread 訊息（續接 session）**：
```typescript
// 現有
await handleAgentRun(chatChannel, prompt, cwd, threadChannel.id, reply, MSG_LIMIT);

// 改為
const verbosity = getVerbosity(parentId);
await handleAgentRun(chatChannel, prompt, cwd, threadChannel.id, reply, MSG_LIMIT, verbosity, message.id);
```

### 9.6 Slack Adapter 改動

#### 9.6.1 Verbosity 狀態管理

在 `createSlackAdapter` 函式內新增：

```typescript
const channelVerbosity = new Map<string, VerbosityMode>();

function getVerbosity(channelId: string): VerbosityMode {
  return channelVerbosity.get(channelId) ?? "normal";
}
```

#### 9.6.2 chatChannel 擴充

```typescript
const chatChannel: ChatChannel = {
  send: async (t) => {
    const res = await client.chat.postMessage({
      channel: channelId,
      text: t,
      thread_ts: replyTs,
    });
    return res.ts;  // 回傳 Slack message timestamp 作為 ID
  },
  sendTyping: () => {},
  edit: async (messageId, text) => {
    await client.chat.update({
      channel: channelId,
      ts: messageId,
      text: text,
    });
  },
  react: async (messageId, emoji) => {
    // Slack 使用文字名稱而非 Unicode
    const slackName = EMOJI_MAP[emoji] || emoji;
    await client.reactions.add({
      channel: channelId,
      timestamp: messageId,
      name: slackName,
    });
  },
  removeReact: async (messageId, emoji) => {
    const slackName = EMOJI_MAP[emoji] || emoji;
    await client.reactions.remove({
      channel: channelId,
      timestamp: messageId,
      name: slackName,
    });
  },
};
```

#### 9.6.3 Emoji 名稱映射

Slack API 使用文字名稱，Discord 使用 Unicode。映射表放在 Slack adapter 內部：

```typescript
const EMOJI_MAP: Record<string, string> = {
  "⏳": "hourglass_flowing_sand",
  "✅": "white_check_mark",
  "❌": "x",
};
```

Discord 不需要映射（直接支援 Unicode emoji）。

#### 9.6.4 Verbosity 指令解析

在 admin commands 區塊新增（在 `/skills` 之後）：

```typescript
const verbosityCommands: Record<string, VerbosityMode> = {
  "/quiet": "quiet",
  "/normal": "normal",
  "/verbose": "verbose",
};
if (text in verbosityCommands) {
  if (!config.channelProjects.get(channelId)) return;  // 未綁定就忽略
  const mode = verbosityCommands[text];
  channelVerbosity.set(channelId, mode);
  await client.chat.postMessage({
    channel: channelId,
    text: `Verbosity set to *${mode}*`,
    thread_ts: messageTs,
  });
  return;
}
```

#### 9.6.5 handleAgentRun 呼叫更新

```typescript
// 現有
await handleAgentRun(chatChannel, prompt, cwd, sessionKey, reply, SLACK_MSG_LIMIT);

// 改為
const verbosity = getVerbosity(channelId);
await handleAgentRun(chatChannel, prompt, cwd, sessionKey, reply, SLACK_MSG_LIMIT, verbosity, messageTs);
```

### 9.7 向後相容驗證

```
場景 1：未下任何 verbosity 指令
  → channelVerbosity.get(channelId) = undefined
  → getVerbosity() 回傳 "normal"
  → createProgressSender 走 normal 路徑（edit-in-place）
  → ⚠️ 注意：v1.1.0 的行為是 verbose（每次 send 新訊息）
  → v1.2.0 的預設變更為 normal（edit-in-place）——這是有意的 UX 改進

場景 2：下了 /verbose 指令
  → channelVerbosity.set(channelId, "verbose")
  → createProgressSender 走 verbose 路徑
  → 行為與 v1.1.0 完全一致 ✅

場景 3：ChatChannel.send() 回傳值變更
  → 現有呼叫端（handleAgentRun 中的 flushText）不使用回傳值
  → 不影響現有邏輯 ✅

場景 4：Slack 缺少 reactions:write scope
  → react/removeReact 呼叫失敗
  → .catch(() => {}) 靜默忽略
  → agent 正常執行，只是沒有 emoji 指示 ✅
```

---

## 變更記錄

| 版本 | 日期 | 變更內容 | 變更者 |
|------|------|---------|--------|
| v2.0 | 2026-03-27 | 合併版初版建立（S 級專案，無 UI/DB，一次產出完整設計） | SD |
| v3.0 | 2026-03-29 | 新增 Verbosity Modes 設計（Section 9） | SD |
