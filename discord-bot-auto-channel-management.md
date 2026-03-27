---
date: 2026-03-27
tags:
  - decision
  - architecture
  - devops
---

# Discord Bot Auto Channel Management

## Context

原本 Claude ACP Discord bot 需要手動用 `/bind` 指令把 channel 綁定到專案目錄。每次新增專案都要手動操作，不夠自動化。

## Decision

加入 directory watcher 機制，自動偵測 `~/Documents/code/` 下的資料夾變動：

- Bot 啟動時執行 `syncProjects()`，掃描目錄並建立對應的 Discord channel
- 使用 `fs.watch` 持續監聽，新增資料夾自動建 channel，刪除自動移除
- 所有自動管理的 channel 歸在 "Projects" category 下
- Debounce 2 秒避免短時間大量 fs event 重複觸發

## 新增設定

- `GUILD_ID` — Discord 伺服器 ID
- `WATCH_DIR` — 要監控的專案根目錄
- `CATEGORY_ID` — 可選，指定 category；留空自動建立 "Projects"

## 新增檔案

- `src/watcher.ts` — 核心 watcher 邏輯
- 修改 `config.ts`、`index.ts`、`.env`

## Trade-offs

- `fs.watch` 在某些 OS/filesystem 上行為不一致（Linux inotify vs macOS FSEvents），但對這個 use case 夠用
- Channel 名稱用 lowercase + hyphen 轉換，可能跟原始資料夾名稱略有不同
- In-memory state，bot 重啟會重新 sync（不是問題，sync 是 idempotent 的）
