# SRS 需求規格書 — Slack 平台擴充

## 文件資訊

| 項目 | 內容 |
|------|------|
| 專案名稱 | claude-discord Multi-Platform Extension (Slack) |
| 版本 | v1.0 |
| 建立日期 | 2026-03-27 |
| 最後修改 | 2026-03-27 |
| 狀態 | 草稿 |

---

## 1. 專案概述

### 1.1 產品描述

claude-discord 是一個讓開發者從 Discord 操作 Claude Code 的 bot。本次擴充的目標是**將架構抽象為多平台支援**，新增 Slack bot 作為第二個平台適配器，讓使用 Slack 的團隊也能享有相同功能。

### 1.2 目標

- **主要目標**：新增 Slack bot 支援，與 Discord bot 功能對等
- **次要目標**：重構為平台抽象架構（Adapter Pattern），使未來擴充其他平台更容易

### 1.3 範圍

**包含在本次範圍內：**
- 平台抽象層（Platform Adapter Interface）
- Slack bot adapter（基於 @slack/bolt）
- Discord bot adapter（重構現有 bot.ts）
- 多平台 config 支援
- CLI 支援啟動指定平台或全部平台
- init wizard 新增 Slack 設定流程

**不在本次範圍內：**
- Slack Slash Commands（使用 Slack 原生 slash command 註冊）——本次沿用訊息觸發模式
- Slack interactive components（buttons、modals）
- 其他平台（Teams、Telegram 等）
- Slack workspace 自動加入（需手動安裝 bot）

### 1.4 參考系統

- 現有 claude-discord bot（v1.0.4）作為功能基準線

---

## 2. 使用者角色

### 2.1 角色定義

| 角色 | 描述 | 主要目標 | 權限等級 |
|------|------|---------|---------|
| 開發者（Slack） | 在 Slack workspace 中使用 Claude Code 的開發者 | 透過 Slack 訊息觸發 Claude Code 操作專案 | 一般 |
| 管理者 | 安裝並設定 bot 的人（通常也是開發者本人） | 設定 bot token、綁定頻道到專案目錄 | 管理者 |

（與現有 Discord 角色完全一致，只是平台不同）

---

## 3. 功能需求

### 3.1 平台抽象層

#### US-001：平台適配器介面
- **角色**：管理者
- **故事**：作為管理者，我希望系統有統一的平台介面，以便同時運行 Discord 和 Slack bot
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** 系統啟動時設定了 Discord 和 Slack token，**When** 執行 `claude-discord start`，**Then** 兩個平台的 bot 同時上線
  2. **Given** 只設定了 Slack token（無 Discord token），**When** 執行 `claude-discord start`，**Then** 只啟動 Slack bot，不報錯
  3. **Given** 只設定了 Discord token（無 Slack token），**When** 執行 `claude-discord start`，**Then** 行為與現有版本完全一致

### 3.2 Slack Bot 核心功能

#### US-002：Slack 訊息觸發 Claude Code
- **角色**：開發者（Slack）
- **故事**：作為開發者，我希望在 Slack 頻道中發送訊息就能觸發 Claude Code 操作對應專案
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** 頻道已綁定到專案目錄，**When** 使用者在頻道中發送訊息，**Then** bot 在該訊息的 thread 中回覆 Claude Code 的結果
  2. **Given** 頻道未綁定到任何專案，**When** 使用者在頻道中發送訊息，**Then** bot 不回應
- **備註**：Slack thread 模型 = 在原始訊息下回覆（reply_broadcast: false）

#### US-003：Slack Thread 持續對話
- **角色**：開發者（Slack）
- **故事**：作為開發者，我希望在同一個 Slack thread 中繼續對話，Claude 能保持上下文
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** 已在 thread 中有一次成功的 Claude 回覆，**When** 使用者在同一 thread 中發送後續訊息，**Then** Claude 使用同一 session 回覆（保持上下文）
  2. **Given** 已有 thread session，**When** 使用者在新的頂層訊息發送，**Then** 建立新的 thread 和新的 session

#### US-004：Slack 進度回報
- **角色**：開發者（Slack）
- **故事**：作為開發者，我希望看到 Claude 正在做什麼（讀檔、編輯、執行指令等），以便知道進度
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** Claude 正在處理請求，**When** Claude 使用工具（Read、Edit、Bash 等），**Then** bot 在 thread 中發送進度訊息
  2. **Given** 進度訊息連續且快速，**Then** 使用 debounce 機制合併同類型工具事件，避免訊息洪水
- **備註**：Slack 訊息長度上限 40,000 字元（遠大於 Discord 的 2,000），但仍需 split 機制以防超長回覆

#### US-005：Slack Skill 系統
- **角色**：開發者（Slack）
- **故事**：作為開發者，我希望在 Slack 中也能使用 /skillname 指令觸發自訂 skill
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** 專案有已定義的 skill，**When** 使用者在 Slack 頻道中發送 `/skillname args`，**Then** bot 載入對應 skill 的 SKILL.md 並執行
- **備註**：Slack 原生 slash commands 會被 Slack 攔截。解法：使用純文字訊息前綴（如 `/pm`）或改用不同前綴（如 `!pm`）。建議沿用 `/` 前綴但不註冊 Slack slash command，因為 Slack bot 收到的訊息是純文字，不會被 slash command 系統攔截（除非同名 slash command 已註冊）

### 3.3 Slack 頻道管理

#### US-006：Slack 自動同步專案頻道
- **角色**：管理者
- **故事**：作為管理者，我希望 WATCH_DIR 下的專案自動在 Slack workspace 中建立對應頻道
- **優先級**：Should Have
- **驗收標準**：
  1. **Given** 設定了 WATCH_DIR 和 SLACK_BOT_TOKEN，**When** bot 啟動，**Then** 為每個專案目錄建立 Slack 頻道（若不存在）
  2. **Given** bot 運行中，**When** WATCH_DIR 下新增專案目錄，**Then** 自動建立新的 Slack 頻道
  3. **Given** bot 運行中，**When** WATCH_DIR 下刪除專案目錄，**Then** 自動歸檔對應的 Slack 頻道
- **備註**：Slack 建立頻道需要 bot 有 `channels:manage` scope。頻道名稱規則同 Discord：小寫、無空格、最長 80 字元

#### US-007：Slack Admin 指令
- **角色**：管理者
- **故事**：作為管理者，我希望在 Slack 中使用 /bind、/unbind、/projects、/skills 指令管理綁定
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** 在非 thread 的頻道中，**When** 使用者發送 `/bind /path/to/project`，**Then** bot 將該頻道綁定到指定目錄
  2. **Given** 在已綁定的頻道中，**When** 使用者發送 `/unbind`，**Then** bot 解除該頻道的綁定
  3. **Given** 任何頻道，**When** 使用者發送 `/projects`，**Then** bot 列出所有綁定的頻道和專案路徑
  4. **Given** 在已綁定的頻道中，**When** 使用者發送 `/skills`，**Then** bot 列出該專案可用的 skill

### 3.4 設定與 CLI

#### US-008：多平台設定
- **角色**：管理者
- **故事**：作為管理者，我希望在一個 .env 檔案中設定多個平台的 token
- **優先級**：Must Have
- **驗收標準**：
  1. **Given** .env 包含 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN`，**When** 啟動 bot，**Then** Slack bot 上線
  2. **Given** .env 同時包含 Discord 和 Slack token，**When** 啟動 bot，**Then** 兩個平台同時運行
- **備註**：Slack 需要兩個 token：Bot Token（xoxb-）用於 API 呼叫，App-Level Token（xapp-）用於 Socket Mode

#### US-009：init wizard 擴充
- **角色**：管理者
- **故事**：作為管理者，我希望 `claude-discord init` 也能引導我設定 Slack
- **優先級**：Should Have
- **驗收標準**：
  1. **Given** 執行 `claude-discord init`，**When** 進入設定流程，**Then** 除了 Discord 設定外，還詢問 Slack Bot Token 和 App Token
  2. **Given** 使用者只想設定 Slack（跳過 Discord），**When** Discord token 留空，**Then** 只寫入 Slack 相關設定

---

## 4. 視覺體驗層級評估

- **建議層級**：不適用（N/A）
- **判斷依據**：本專案為 CLI 工具 + chat bot，無 Web UI

---

## 5. 非功能性需求

### 5.1 效能需求
- 訊息處理延遲：< 1s（從收到訊息到開始 Claude Code 執行）
- 進度回報延遲：debounce 1.5s（與 Discord 一致）

### 5.2 安全性需求
- Bot token 存放在 ~/.claude-discord/.env，不進 git
- Slack Socket Mode（不需公開 HTTP endpoint，無需 HTTPS 設定）

### 5.3 相容性需求
- Node.js >= 18
- macOS / Linux
- Slack API（Socket Mode，不需 HTTP server）

### 5.4 其他
- Slack 訊息長度上限：40,000 字元（需 split 機制但閾值不同）
- Slack rate limiting：Tier 1 API（約 1 req/s），進度回報需考慮 rate limit

---

## 6. 業務流程

### 6.1 Slack 訊息處理流程

**正常流程：**
1. 使用者在 Slack 頻道發送訊息
2. Bot 收到 `message` 事件
3. 檢查：是否為 bot 自己的訊息？→ 是：忽略
4. 檢查：是否為 admin 指令（/bind、/unbind 等）？→ 是：執行 admin 指令
5. 檢查：是否在 thread 中？
   - 否（頂層訊息）：解析 project cwd → 解析 skill → 呼叫 agent → 在 thread 中回覆結果
   - 是（thread 回覆）：查找 thread session → 繼續 agent 對話 → 在 thread 中回覆
6. Agent 執行期間：streaming 進度回報到 thread
7. Agent 完成：發送最終結果 + 費用資訊

**異常流程：**
- 若頻道未綁定專案 → 忽略訊息
- 若 agent 執行出錯 → 在 thread 中回報錯誤訊息
- 若 Slack API rate limit → 延遲重試進度訊息

### 6.2 多平台啟動流程

**正常流程：**
1. 讀取 .env 設定
2. 解析哪些平台有設定 token
3. 為每個有效平台建立 adapter instance
4. 啟動所有 adapter（各自連線到平台）
5. 每個 adapter 獨立處理自己的事件迴圈
6. 共用：agent.ts（Claude Code 執行）、skills.ts（skill 系統）

---

## 7. 假設與限制

### 7.1 假設
- 使用者已在 Slack 後台建立 App 並取得 Bot Token 和 App-Level Token
- Slack App 已啟用 Socket Mode
- Slack App 已訂閱 `message.channels`、`message.groups` 事件

### 7.2 限制
- Slack 建立頻道需要 `channels:manage` scope
- Slack Socket Mode 需要 App-Level Token（xapp-）
- Slack bot 無法加入私人頻道除非被邀請

### 7.3 依賴
- @slack/bolt（Slack Bot Framework）
- @slack/web-api（Slack Web API，bolt 內含）

---

## 8. 名詞定義

| 術語 | 定義 |
|------|------|
| Platform Adapter | 平台適配器，封裝特定平台（Discord/Slack）的 API 互動邏輯 |
| Socket Mode | Slack 的 WebSocket 連線模式，不需公開 HTTP endpoint |
| Bot Token (xoxb-) | Slack Bot User OAuth Token，用於 API 呼叫 |
| App Token (xapp-) | Slack App-Level Token，用於 Socket Mode 連線 |
| Thread Session | 一個 thread 對應一個 Claude Code session，保持上下文 |

---

## 變更記錄

| 版本 | 日期 | 變更內容 | 變更者 |
|------|------|---------|--------|
| v1.0 | 2026-03-27 | 初版建立 | SA |
