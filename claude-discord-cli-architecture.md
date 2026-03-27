---
date: 2026-03-27
tags:
  - decision
  - architecture
  - devops
---

# claude-discord 開源 CLI 架構

## Context

原本 claude-discord (claude_acp) 是一個本機跑的 Discord bot，需要手動 `npm run dev` 啟動、手動編輯 `.env` 設定。要開源上 npm 需要更好的 UX。

## Decision

改造成完整 CLI 工具，`npm install -g claude-discord` 後用指令操作：

- `claude-discord init` — 互動式設定精靈，產生 `~/.claude-discord/.env`
- `claude-discord start` — 前景啟動（測試用）
- `claude-discord install-service` — 安裝背景服務
  - macOS: LaunchAgent (~/Library/LaunchAgents/)
  - Linux: systemd user service
- `claude-discord uninstall-service` — 移除背景服務
- `claude-discord status` — 顯示設定與服務狀態

## Key design choices

- **Config 路徑獨立**：`~/.claude-discord/.env`，不跟專案原始碼綁定
- **LaunchAgent/systemd 動態產生**：偵測 `which node` 和安裝路徑，不寫死
- **保留 legacy entry**：`npm run dev` 和 `index.ts` 仍可用，向後相容
- **package.json bin field**：`"claude-discord": "dist/cli.js"`，全局安裝即可用
- **跨平台**：macOS + Linux，Windows 建議用 `start` + task scheduler

## 檔案結構

```
src/
├── cli.ts                  ← CLI entry point
├── commands/
│   ├── init.ts             ← 設定精靈
│   ├── start.ts            ← 前景啟動
│   ├── install-service.ts  ← 背景服務安裝
│   ├── uninstall-service.ts
│   └── status.ts
├── index.ts                ← Legacy entry
├── bot.ts / agent.ts / config.ts / watcher.ts
```

## Trade-offs

- 沒用 commander/yargs 等 CLI 框架，保持零額外依賴
- readline 的互動式 prompt 比較陽春，但夠用
- 不支援 Windows daemon（市場太小，文件說明即可）
