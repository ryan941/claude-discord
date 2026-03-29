# 技術可行性報告 — claude-discord Multi-Platform Bot

## 文件資訊

| 項目 | 內容 |
|------|------|
| 版本 | v1.2 |
| 建立日期 | 2026-03-27 |
| 最後修改 | 2026-03-29 |
| 規模等級 | S（CLI 工具 + Bot） |

---

## 1. 開發環境偵測

| 項目 | 偵測結果 | 要求 | 狀態 |
|------|---------|------|------|
| Node.js | v25.6.1 | >= 18 | ✅ |
| npm | 11.9.0 | - | ✅ |
| TypeScript | 5.9.3（local） | 5.x | ✅ |
| OS | macOS 26.3.1 (arm64) | macOS / Linux | ✅ |

環境完全符合要求，無版本衝突。

---

## 2. 技術選型核心決策

### ADR-001：Slack SDK 選型 — @slack/bolt

**狀態**：已採納

**背景**：需要選擇 Slack SDK 來實作 bot 功能。

**決策**：使用 `@slack/bolt`（Bolt for JavaScript）

| 方案 | 優點 | 缺點 |
|------|------|------|
| **@slack/bolt（已選）** | 官方推薦框架；內建 Socket Mode 支援；事件監聽 API 簡潔（`app.message()`）；內含 @slack/web-api；社區活躍（High reputation, score 88.95） | 稍重於 raw API（多一層抽象）；bundle 略大 |
| @slack/web-api + @slack/socket-mode | 更輕量；完全控制 | 需手動處理事件路由、reconnection、ack；更多 boilerplate |

**後果**：@slack/bolt 提供的抽象與 discord.js 的 `client.on("messageCreate")` 模式高度相似，降低 adapter 實作的認知負擔。Socket Mode 內建，無需公開 HTTP endpoint。

### ADR-002：架構模式 — Platform Adapter Pattern

**狀態**：已採納

**背景**：需要讓 Discord 和 Slack 共用核心邏輯（agent.ts、skills.ts），同時各自處理平台特定的事件和 API。

**決策**：採用 Adapter Pattern，定義 `PlatformAdapter` 介面

```
src/
├── platforms/
│   ├── types.ts          # PlatformAdapter interface
│   ├── discord/
│   │   ├── bot.ts        # 重構自現有 bot.ts
│   │   └── watcher.ts    # 重構自現有 watcher.ts
│   └── slack/
│       ├── bot.ts        # 新增：Slack event handling
│       └── watcher.ts    # 新增：Slack channel sync
├── agent.ts              # 不動
├── skills.ts             # 不動
├── config.ts             # 擴充：多平台設定
├── cli.ts                # 擴充：平台選擇
└── index.ts              # 擴充：多平台啟動
```

**PlatformAdapter 介面核心契約**：
```typescript
interface PlatformAdapter {
  name: string;                           // "discord" | "slack"
  start(): Promise<void>;                 // 連線到平台
  stop(): Promise<void>;                  // 斷線
  bindChannel(channelId: string, cwd: string): void;
  unbindChannel(channelId: string): void;
  getProjectCwd(channelId: string): string | null;
}
```

**後果**：
- ✅ agent.ts 和 skills.ts 完全不動
- ✅ 新平台只需實作 adapter，不影響既有平台
- ✅ Discord adapter 是對現有 bot.ts 的輕度重構，非重寫
- ⚠️ 每個平台仍有自己的 bot.ts 和 watcher.ts（因為事件模型不同，不適合強行統一）

---

## 3. Slack 平台技術要點

### 3.1 Socket Mode（✅ 可行）

- Bolt 內建 Socket Mode，設定 `socketMode: true` + `appToken` 即可
- 無需公開 HTTP endpoint、無需 HTTPS 憑證
- WebSocket 長連線，與 discord.js 的 Gateway 機制相似
- 適合本地開發和私人部署場景

### 3.2 Thread 模型（✅ 相容）

| 概念 | Discord | Slack |
|------|---------|-------|
| 頂層訊息 | Channel message | Channel message |
| 對話續接 | Thread（startThread） | Thread（reply with thread_ts） |
| Session 鍵 | thread.id | message.ts（thread parent timestamp） |

Slack 的 thread 是在原始訊息下回覆（使用 `thread_ts`）。`say({ text, thread_ts: message.ts })` 即可在 thread 中回覆。Session 映射邏輯完全相容。

### 3.3 訊息長度（✅ 無問題）

- Slack 上限 40,000 字元（Discord 2,000）
- 現有 `splitMessage()` 邏輯可複用，只需調整閾值常數
- 實務上 Claude 回覆很少超過 40,000 字元

### 3.4 Rate Limiting（⚠️ 需注意）

- `chat.postMessage`：~1 msg/s per channel（Tier 4 special）
- 現有 debounce 機制（1.5s）已足夠應對
- 進度訊息合併（mergeable tools）進一步降低 API 呼叫頻率
- **結論**：現有設計無需額外調整即可滿足 Slack rate limit

### 3.5 頻道管理（✅ 可行，需 scope）

- `conversations.create`：Tier 2（20/min），足夠
- 需要 bot scope：`channels:manage`、`channels:read`、`channels:join`
- 頻道名稱規則：小寫、連字號、最長 80 字元（與 Discord 類似）

### 3.6 Skill 前綴相容性（✅ 無衝突）

- Slack 原生 Slash Commands 需在 Slack App 後台明確註冊
- 未註冊的 `/xxx` 會被 Slack 視為純文字發送（不會攔截）
- 因此 `/pm`、`/skills` 等前綴在 Slack 中正常運作，前提是不註冊同名 Slash Command

---

## 4. 重構成本評估

| 項目 | 變更量 | 說明 |
|------|--------|------|
| agent.ts | 0 行 | 完全不動 |
| skills.ts | 0 行 | 完全不動 |
| config.ts | ~50 行修改 | 新增 Slack token 欄位，多平台設定解析 |
| bot.ts | ~100 行重構 | 提取共用邏輯（splitMessage、createProgressSender）到 utils，Discord 特定邏輯搬到 platforms/discord/ |
| watcher.ts | ~50 行重構 | Discord 特定邏輯搬到 platforms/discord/ |
| cli.ts | ~30 行修改 | 新增平台選項 |
| index.ts | ~30 行修改 | 多平台啟動邏輯 |
| **新增 Slack bot** | ~250 行 | platforms/slack/bot.ts（模式與 Discord bot 高度對稱） |
| **新增 Slack watcher** | ~150 行 | platforms/slack/watcher.ts |
| **新增共用 utils** | ~80 行 | platforms/utils.ts（splitMessage、progressSender 等） |
| **新增 types** | ~30 行 | platforms/types.ts（PlatformAdapter interface） |

**總計**：~770 行變更/新增，其中真正的新邏輯約 400 行（Slack adapter），其餘為搬移和輕度重構。

---

## 5. 風險評估

| 風險 | 嚴重度 | 機率 | 緩解措施 |
|------|--------|------|---------|
| Slack App 設定複雜（scope、event subscription） | 低 | 中 | README 加入詳細設定指南 |
| Slack Socket Mode 連線不穩 | 低 | 低 | Bolt 內建重連機制 |
| `/` 前綴與 Slack Slash Command 衝突 | 低 | 低 | 文件說明不要在 Slack App 註冊同名 command |

---

## 6. 可行性判定

**✅ 可行**

- @slack/bolt 成熟穩定，Socket Mode 免除部署複雜度
- Slack 的 thread、channel、message 模型與 Discord 高度對稱
- 現有 agent.ts 和 skills.ts 100% 複用
- 重構量可控（~770 行），核心是搬移而非重寫
- 無技術阻塞項

---

## 7. Verbosity Modes 可行性評估（v1.1 新增）

### 7.1 平台 API 能力確認

| 能力 | Discord（discord.js v14.25.1） | Slack（@slack/bolt v4.6.0） | 現有使用 |
|------|------|------|------|
| 發送訊息 | `channel.send()` → 回傳 `Message` 物件 | `client.chat.postMessage()` → 回傳含 `ts` 的 response | ✅ 已使用 |
| 編輯訊息 | `Message.edit(newText)` | `client.chat.update({ channel, ts, text })` | ❌ 未使用，API 可用 |
| 加 Reaction | `Message.react(emoji)` | `client.reactions.add({ channel, timestamp, name })` | ❌ 未使用，API 可用 |
| 移除 Reaction | `MessageReaction.remove()` （bot 自己的） | `client.reactions.remove({ channel, timestamp, name })` | ❌ 未使用，API 可用 |
| 訊息識別 | `Message.id`（string） | `ts`（timestamp string） | — |

**結論**：兩個平台都原生支援 edit-in-place 和 emoji reaction，無需第三方套件，無技術阻塞。

### 7.2 ChatChannel 介面擴充方案

現有介面：
```typescript
interface ChatChannel {
  send(text: string): Promise<void>;
  sendTyping(): void;
}
```

擴充為：
```typescript
interface ChatChannel {
  send(text: string): Promise<string | undefined>;  // 回傳 message ID
  sendTyping(): void;
  edit(messageId: string, text: string): Promise<void>;  // 新增
  react(messageId: string, emoji: string): Promise<void>;  // 新增
  removeReact(messageId: string, emoji: string): Promise<void>;  // 新增
}
```

**設計決策**：

1. **`send()` 回傳 message ID**：Discord 的 `channel.send()` 已回傳 `Message` 物件（含 `.id`），Slack 的 `chat.postMessage()` 已回傳含 `ts` 的 response。只需在 wrapper 中提取並回傳。向後相容——現有呼叫端只需忽略回傳值
2. **`edit()` / `react()` / `removeReact()` 為必要方法**：兩個平台都支援，不需用 optional 增加複雜度。實作中用 `.catch(() => {})` 靜默處理失敗
3. **不擴充 ReplyHandler**：verbosity 邏輯集中在 `handleAgentRun` 和 `createProgressSender`，ReplyHandler 只負責最終結果和錯誤，不受 verbosity 影響

### 7.3 Edit-in-place 技術要點

**Discord**：
- `Message.edit()` 直接可用，無需 fetch（send 已回傳 Message 物件）
- 限制：只能編輯 bot 自己發送的訊息 ✅（進度訊息由 bot 發送）
- Rate limit：discord.js 內建佇列處理，無需額外管理

**Slack**：
- `chat.update({ channel, ts, text })` 需要 channel ID + message ts
- 限制：只能更新 bot 自己發送的訊息 ✅；需要 `chat:write` scope（已有）
- Rate limit：`chat.update` 與 `chat.postMessage` 共用 Tier 4 special（~1/s per channel）。現有 1.5s debounce 已滿足

**訊息快取策略**：
- `createProgressSender` 在第一次 flush 時呼叫 `send()`，快取回傳的 message ID
- 後續 flush 使用快取的 ID 呼叫 `edit()`
- 快取生命週期 = 單次 agent 執行（函式 scope，無記憶體洩漏風險）
- 若 `edit()` 失敗（例如訊息已被刪除），fallback 為 `send()` 新訊息並更新快取

**競態防護**：
- 現有 debounce（1.5s）已大幅降低併發 edit 的機會
- 額外加入簡單 lock：flush 進行中時暫存最新內容，flush 完成後再送最新版本
- 不需要複雜的佇列機制——debounce + lock 已足夠

### 7.4 Emoji Reaction 技術要點

**Discord**：
- `Message.react('⏳')` / `Message.react('✅')` / `Message.react('❌')`
- 移除自己的 reaction：`reaction.users.remove(client.user.id)`
- 需要存取使用者的原始 Message 物件（在 `messageCreate` handler 中已有）

**Slack**：
- `reactions.add({ channel, timestamp: message.ts, name: 'hourglass_flowing_sand' })`
- `reactions.remove({ channel, timestamp: message.ts, name: 'hourglass_flowing_sand' })`
- 需要額外 scope：**`reactions:write`**（v1.1 新增需求，需在 Slack App 設定頁面加入）
- Emoji 名稱格式不同：Slack 用文字名稱（`hourglass_flowing_sand`），Discord 用 Unicode（`⏳`）

**平台差異處理**：reaction 邏輯在各平台 adapter 內部實作，ChatChannel 介面統一接受 emoji 識別符，由 adapter 轉換為平台格式。

### 7.5 Verbosity 狀態儲存方案

**方案**：per-channel runtime Map，與 channelProjects 並列

```typescript
// 在各平台 adapter 內部
const channelVerbosity = new Map<string, "quiet" | "normal" | "verbose">();
```

**設計決策**：
- **不持久化**：重啟後重置為 `normal`。理由：verbosity 是臨時偏好，不是系統設定。使用者通常 set-and-forget，重啟後回到合理預設值即可
- **per-channel**：不同頻道可能有不同偏好（例如 debug 頻道用 verbose，日常頻道用 normal）
- **admin 指令解析**：沿用現有 `startsWith` 模式，在 `/bind`、`/unbind` 等指令旁加入 `/quiet`、`/normal`、`/verbose`

### 7.6 變更量評估

| 檔案 | 變更量 | 說明 |
|------|--------|------|
| platforms/types.ts | ~10 行修改 | ChatChannel 新增 edit/react/removeReact + send 回傳值調整 |
| platforms/utils.ts | ~60 行修改 | createProgressSender 加入 verbosity 分支 + handleAgentRun 接收 verbosity + reaction 邏輯 |
| platforms/discord/bot.ts | ~40 行修改 | wrapDiscordChannel 實作 edit/react + 解析 verbosity 指令 + 傳遞 reaction 用的 message 物件 |
| platforms/slack/bot.ts | ~40 行修改 | chatChannel 實作 edit/react + 解析 verbosity 指令 |
| agent.ts | 0 行 | 不動 |
| skills.ts | 0 行 | 不動 |
| config.ts | 0 行 | 不動（verbosity 不走 env var，走 runtime 指令） |

**總計**：~150 行變更，全部是既有檔案的擴充，無新增檔案。

### 7.7 風險評估

| 風險 | 嚴重度 | 機率 | 緩解措施 |
|------|--------|------|---------|
| edit API 呼叫失敗 | 低 | 低 | fallback 為 send 新訊息 |
| reaction API 缺少 scope | 低 | 中 | 靜默忽略 + README 說明所需 scope |
| 1.5s debounce 下的 edit 競態 | 低 | 極低 | debounce 已天然防護 + 簡單 lock |
| Slack emoji 名稱格式不符 | 低 | 低 | 平台 adapter 內部映射 |

### 7.8 可行性判定

**✅ 可行**

- 兩個平台的 edit 和 reaction API 原生支援，成熟穩定
- 變更量極小（~150 行），集中在 utils.ts 和兩個 adapter
- agent.ts、skills.ts、config.ts 零修改
- 所有失敗場景都有優雅降級（fallback 到現有行為）
- 無新增依賴
- 向後相容：未設定 verbosity 的頻道預設 normal，行為與 v1.1.0 一致

---

## 8. Interactive Permission Confirmation 可行性評估（v1.2 新增）

### 8.1 SDK canUseTool API 確認

**已驗證 SDK 型別定義**（`@anthropic-ai/claude-agent-sdk/sdk.d.ts`）：

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;

type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: "deny"; message: string; interrupt?: boolean };
```

`query()` 的 `Options` 已包含 `canUseTool?: CanUseTool` 參數。與 `permissionMode: "default"` 搭配使用時，SDK 動態判斷哪些工具需要權限，只對需要權限的工具呼叫 `canUseTool`。

**結論**：SDK 原生支援，API 穩定，無需 workaround。

### 8.2 架構橋接方案

**核心挑戰**：`agent.ts` 是平台無關的，但 `canUseTool` callback 需要發送平台特定的按鈕訊息（Discord Buttons / Slack Block Kit）。

**方案：Callback Injection（依賴反轉）**

```
Platform Adapter（Discord/Slack）
    │ 建立 canUseTool callback（閉包捕獲平台物件）
    ↓
handleAgentRun(channel, prompt, cwd, ..., permissionHandler)
    │ 透傳
    ↓
runAgent(prompt, cwd, threadId, callbacks, permissionHandler)
    │ 傳給 SDK
    ↓
query({ prompt, options: { canUseTool: permissionHandler, permissionMode: "default" } })
```

**具體做法**：
1. 新增 `PermissionHandler` type（與 SDK 的 `CanUseTool` 對齊）到 `types.ts`
2. `runAgent()` 新增 optional `permissionHandler` 參數
3. `handleAgentRun()` 新增 optional `permissionHandler` 參數，透傳給 `runAgent()`
4. 各平台 adapter 建立閉包 callback，捕獲平台特定的 channel/client 物件

**為什麼用 Callback Injection 而非擴充 ChatChannel**：
- `canUseTool` 需要的是「發送按鈕 + 等待互動回應」，這是一個完整的 request-response 週期
- `ChatChannel` 的 `send()` 是 fire-and-forget，不適合等待使用者互動
- Discord 的 `awaitMessageComponent()` 和 Slack 的 `app.action()` 是完全不同的互動模型，不適合統一到一個介面
- Callback 讓每個平台自由選擇最適合的互動實作

### 8.3 Discord Button 技術要點

**API**：
```typescript
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// 發送按鈕訊息
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId("allow").setLabel("Allow").setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId("deny").setLabel("Deny").setStyle(ButtonStyle.Danger),
);
const msg = await thread.send({ content: "🔒 Permission Required\n...", components: [row] });

// 等待互動（blocking，帶超時）
const interaction = await msg.awaitMessageComponent({ time: 60_000 });
await interaction.update({ content: "✅ Allowed", components: [] });  // 移除按鈕
```

**技術確認**：
- `awaitMessageComponent()` 是 discord.js v14 的原生 API ✅
- 不需要額外的 Gateway Intent（`GuildMessages` + `MessageContent` 已足夠）✅
- 超時自動 reject promise → catch 中回傳 deny ✅
- `interaction.update()` 可同時更新文字和移除按鈕（設 `components: []`）✅
- 按鈕互動有 3 秒回應期限（`interaction.update` 或 `interaction.deferUpdate`）——在 callback 內直接呼叫，不會超過 ✅

### 8.4 Slack Block Kit 技術要點

**API**：
```typescript
// 發送 Block Kit 按鈕訊息
const result = await client.chat.postMessage({
  channel: channelId,
  thread_ts: replyTs,
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: "🔒 *Permission Required*\n..." } },
    { type: "actions", block_id: `perm_${uniqueId}`, elements: [
      { type: "button", text: { type: "plain_text", text: "✅ Allow" }, action_id: `allow_${uniqueId}`, style: "primary" },
      { type: "button", text: { type: "plain_text", text: "❌ Deny" }, action_id: `deny_${uniqueId}`, style: "danger" },
    ]},
  ],
});

// 等待互動（需要 Promise 橋接）
```

**Slack 互動的關鍵挑戰：`app.action()` 是 event-driven，不是 request-response**

Discord 的 `awaitMessageComponent()` 天然 blocking，但 Slack 的 `app.action()` 是全域 handler，需要 Promise 橋接：

```typescript
// 橋接策略：用 Map<actionId, resolve> 做 pending promise registry
const pendingPermissions = new Map<string, (allowed: boolean) => void>();

// 全域 action handler（在 createSlackAdapter 中註冊一次）
app.action(/^(allow|deny)_/, async ({ action, ack, client }) => {
  await ack();
  const actionId = action.action_id;
  const uniqueId = actionId.split("_").slice(1).join("_");
  const resolve = pendingPermissions.get(uniqueId);
  if (resolve) {
    resolve(actionId.startsWith("allow"));
    pendingPermissions.delete(uniqueId);
  }
  // 更新訊息移除按鈕
  await client.chat.update({ channel, ts, blocks: [{ type: "section", text: "✅ Allowed" }] });
});

// 在 canUseTool callback 中
const uniqueId = `${Date.now()}_${toolUseID}`;
// 發送按鈕...
const userChoice = await Promise.race([
  new Promise<boolean>(resolve => pendingPermissions.set(uniqueId, resolve)),
  new Promise<boolean>((_, reject) => setTimeout(() => reject("timeout"), 60_000)),
]);
```

**技術確認**：
- `app.action()` 在 Socket Mode 下原生支援 ✅
- 不需要 HTTP endpoint ✅
- 不需要額外 Slack scope（`chat:write` 已包含 Block Kit）✅
- `action_id` 用 timestamp + toolUseID 確保唯一性 ✅
- `ack()` 必須在 3 秒內呼叫（handler 內直接呼叫，不會超過）✅

### 8.5 超時處理

| 平台 | 超時機制 | 失敗行為 |
|------|---------|---------|
| Discord | `awaitMessageComponent({ time: 60_000 })` → reject | catch → deny |
| Slack | `Promise.race([actionPromise, timeoutPromise])` → reject | catch → deny |

**兩平台超時後的共同行為**：
1. `canUseTool` 回傳 `{ behavior: "deny", message: "Permission timed out (60s)" }`
2. 更新按鈕訊息為「⏰ Timed out」（移除按鈕）
3. 清理 pending registry（Slack）
4. Agent 收到 deny → 依 system prompt 停止並回報

### 8.6 變更量評估

| 檔案 | 變更量 | 說明 |
|------|--------|------|
| agent.ts | ~15 行修改 | runAgent 新增 permissionHandler 參數，query options 加入 canUseTool + permissionMode 改為 "default" |
| platforms/types.ts | ~5 行新增 | PermissionHandler type alias |
| platforms/utils.ts | ~5 行修改 | handleAgentRun 新增 permissionHandler 參數，透傳給 runAgent |
| platforms/discord/bot.ts | ~50 行新增 | 建立 canUseTool 閉包（ActionRow + ButtonBuilder + awaitMessageComponent） |
| platforms/slack/bot.ts | ~60 行新增 | pendingPermissions Map + app.action handler + 建立 canUseTool 閉包（Block Kit + Promise 橋接） |
| skills.ts | 0 行 | 不動 |
| config.ts | 0 行 | 不動 |

**總計**：~135 行變更/新增。

### 8.7 風險評估

| 風險 | 嚴重度 | 機率 | 緩解措施 |
|------|--------|------|---------|
| Slack action handler 未收到 ack → Slack 重試 | 中 | 低 | handler 開頭立即 `await ack()` |
| pendingPermissions Map 記憶體洩漏（超時未清理）| 低 | 低 | 超時的 catch 中主動 delete |
| Discord interaction 3 秒回應期限 | 低 | 極低 | update 在 handler 內直接呼叫 |
| 從 bypassPermissions 切換到 default 後的行為差異 | 中 | 中 | 充分測試，確認 SDK 的 default 邏輯符合預期 |
| 同時多個 permission request 互相干擾 | 低 | 低 | 用 unique action_id 隔離 |

### 8.8 可行性判定

**✅ 可行**

- SDK 原生支援 `canUseTool` callback，API 清晰穩定
- Discord `awaitMessageComponent()` 和 Slack `app.action()` 都是成熟 API
- Callback Injection 模式保持 agent.ts 的平台無關性
- 變更量 ~135 行，集中在 agent.ts 和兩個 adapter
- 超時處理兩平台都有原生支援
- 失敗安全：所有異常都 fallback 為 deny

---

## 變更記錄

| 版本 | 日期 | 變更內容 | 變更者 |
|------|------|---------|--------|
| v1.0 | 2026-03-27 | 初版建立（Slack 擴充） | Architect |
| v1.1 | 2026-03-29 | 新增 Verbosity Modes 可行性評估（Section 7） | Architect |
| v1.2 | 2026-03-29 | 新增 Interactive Permission Confirmation 可行性評估（Section 8） | Architect |
