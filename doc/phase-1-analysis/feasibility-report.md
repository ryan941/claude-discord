# 技術可行性報告 — Slack 平台擴充

## 文件資訊

| 項目 | 內容 |
|------|------|
| 版本 | v1.0 |
| 建立日期 | 2026-03-27 |
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

## 變更記錄

| 版本 | 日期 | 變更內容 | 變更者 |
|------|------|---------|--------|
| v1.0 | 2026-03-27 | 初版建立 | Architect |
