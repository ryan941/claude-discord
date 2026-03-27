# 測試報告 — Slack 平台擴充

## 文件資訊

| 項目 | 內容 |
|------|------|
| 版本 | v1.0 |
| 建立日期 | 2026-03-27 |
| 測試方式 | 靜態程式碼審查 + build 驗證 |
| 範圍 | S 級專案精簡測試 |

---

## 1. Build 驗證

| 項目 | 結果 |
|------|------|
| `tsc --noEmit` | ✅ 零錯誤 |
| `npm run build` | ✅ 編譯成功 |
| dist/ 輸出結構 | ✅ platforms/discord/, platforms/slack/, platforms/types.js, platforms/utils.js |

---

## 2. 靜態程式碼審查

### 2.1 向後相容性（US-001 驗收標準 3）

| 檢查項 | 結果 | 說明 |
|--------|------|------|
| 只有 DISCORD_TOKEN 時不報錯 | ✅ | config.ts:51 — 只在兩個平台都沒設定時 throw |
| Discord adapter 邏輯保留 | ✅ | platforms/discord/bot.ts 與原 bot.ts 邏輯一致 |
| Discord watcher 邏輯保留 | ✅ | platforms/discord/watcher.ts 與原 watcher.ts 邏輯一致 |
| CLI `start` 無 --platform 時 = 啟動所有 | ✅ | cli.ts getPlatform() 預設 "all" |
| `npm run dev` 仍可使用 | ✅ | index.ts 保留 `require.main === module` 入口 |

### 2.2 多平台設定（US-008）

| 檢查項 | 結果 | 說明 |
|--------|------|------|
| Discord + Slack 同時設定 | ✅ | loadConfig 分別解析兩個平台 |
| 只有 Slack 設定 | ✅ | discord = undefined, 不會建 Discord adapter |
| SLACK_BOT_TOKEN 無 SLACK_APP_TOKEN | ✅ | slack = undefined，不報錯 |
| CHANNEL_PROJECTS 解析 | ✅ | parseChannelProjects 支援空值 + JSON 解析 |

### 2.3 共用邏輯正確提取

| 函式 | 原行為保留 | 參數化 | 說明 |
|------|-----------|--------|------|
| splitMessage | ✅ | limit 參數 | 原硬編碼 2000 → 現可配置 |
| createProgressSender | ✅ | ChatChannel + msgLimit | 完整保留 merge 邏輯 |
| handleAgentRun | ✅ | ReplyHandler 抽象 | 原嵌入式邏輯提取為共用 |
| listProjectDirs | ✅ | 不變 | 供兩個 watcher 共用 |
| projectToChannelName | ✅ | 不變 | max 80（Slack 限制） |
| IGNORE_DIRS | ✅ | 不變 | 共用 |

### 2.4 Slack Adapter 結構完整性

| 功能 | 狀態 | 說明 |
|------|------|------|
| Socket Mode 初始化 | ✅ | App({ socketMode: true, appToken }) |
| Message event 監聽 | ✅ | app.event("message") |
| Bot message 過濾 | ✅ | "bot_id" in event \|\| event.subtype |
| Admin 指令 /bind | ✅ | 非 thread 時觸發 |
| Admin 指令 /unbind | ✅ | 非 thread 時觸發 |
| Admin 指令 /projects | ✅ | 非 thread 時觸發 |
| Admin 指令 /skills | ✅ | 非 thread 時觸發 |
| Thread session 映射 | ✅ | sessionKey = threadTs \|\| messageTs |
| Skill 系統 | ✅ | resolveSkill + buildSkillPrompt |
| ChatChannel 包裝 | ✅ | chat.postMessage with thread_ts |
| Typing indicator | ✅ | Noop（Slack 無等效 API） |
| Watcher 頻道建立 | ✅ | conversations.create |
| Watcher 頻道歸檔 | ✅ | conversations.archive |
| Watcher fs.watch | ✅ | 2s debounce |

### 2.5 發現的問題

#### BUG-001：Slack `/skills` 不支援 thread 內使用

| 項目 | 內容 |
|------|------|
| 嚴重度 | Low |
| 分類 | 行為差異 |
| 說明 | Discord adapter 中 `/skills` 可在 thread 內使用（解析 parentId）。Slack adapter 所有 admin 指令限制 `!threadTs`，因此 thread 內無法用 `/skills` |
| 影響 | 輕微——使用者可回到主頻道使用 `/skills` |
| 建議 | 列為 known issue，不阻擋發佈 |

#### CLEANUP-001：舊 src/bot.ts 和 src/watcher.ts 未刪除

| 項目 | 內容 |
|------|------|
| 嚴重度 | Low |
| 分類 | 清理 |
| 說明 | 原始檔案已被 platforms/ 下的新檔案取代，但舊檔案仍存在。不影響功能（無 import），但 build 會產出多餘的 dist/bot.js 和 dist/watcher.js |
| 建議 | commit 前刪除 |

#### CLEANUP-002：config.ts BotConfig legacy type alias

| 項目 | 內容 |
|------|------|
| 嚴重度 | Low |
| 分類 | 清理 |
| 說明 | config.ts:66 的 BotConfig type alias 無人使用 |
| 建議 | 移除 |

---

## 3. 品質評分

| 指標 | 結果 | 標準 |
|------|------|------|
| Build | ✅ 通過 | 零錯誤 |
| Critical Bug | 0 | 0 |
| High Bug | 0 | 0 |
| Medium Bug | 0 | < 5 |
| Low Bug | 1（BUG-001） | — |
| Cleanup | 2（CLEANUP-001, 002） | — |

---

## 4. 結論

**✅ 通過**（Critical=0, High=0, Medium=0）

Low 級 BUG-001 和兩個 cleanup 項目不阻擋發佈。建議 commit 前處理 CLEANUP-001 和 CLEANUP-002。

---

## 變更記錄

| 版本 | 日期 | 變更內容 | 變更者 |
|------|------|---------|--------|
| v1.0 | 2026-03-27 | 初版建立 | QA |
