# claude-discord (Multi-Platform Bot)

> 本檔案由 PM 自動維護，每次 Phase 轉換和重大決策時更新。
> 最後更新：2026-03-29

## 當前狀態

- **版本**：v1.1.0（已發佈）
- **最新功能**：Interactive Permission Confirmation（v1.3.0）
- **Phase**：DONE
- **阻塞事項**：無
- **下一步**：git push（待確認）

## 專案概述

- **目標**：多平台 Claude Code bot（Discord + Slack），讓開發者透過聊天平台操作 Claude Code
- **目標使用者**：開發者（使用 Discord 或 Slack 與 Claude Code 互動）
- **啟動日期**：2026-03-27
- **現有功能**：
  - Discord bot + Slack bot（Platform Adapter Pattern）
  - 自動同步專案頻道（WATCH_DIR）
  - Thread-based session（跨訊息上下文保持）
  - Skill system（`/skillname args` 觸發自訂 skill）
  - Streaming progress（即時進度回報 + debounce 合併）

## 技術棧摘要

- **Runtime**：Node.js >= 18
- **語言**：TypeScript (strict)
- **依賴**：discord.js, @slack/bolt, @anthropic-ai/claude-agent-sdk, dotenv
- **部署**：macOS LaunchAgent / Linux systemd

## 關鍵決策

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-03-27 | 採用 Platform Adapter Pattern | 讓 Discord/Slack 共用 agent.ts + skills.ts，新平台只需實作 adapter |
| 2026-03-27 | Slack 使用 Socket Mode | 無需公開 HTTP endpoint，適合本地開發和私人部署 |
| 2026-03-29 | 採用三段式 Verbosity Modes | 平衡 Discord 訊息顯示的資訊量和整潔度（quiet/normal/verbose） |
| 2026-03-29 | permissionMode: default + canUseTool | 讓 SDK 安全機制在 Discord/Slack 生效，與 terminal 一致 |

## 已完成交付物

- ✅ SRS v1.0（Slack 擴充）— `doc/phase-1-analysis/srs.md`
- ✅ 可行性報告 v1.0 — `doc/phase-1-analysis/feasibility-report.md`
- ✅ SDD v2.0（Slack 擴充）— `doc/phase-2-design/sdd.md`
- ✅ Release Notes v1.1.0 — `doc/phase-5-delivery/release-notes.md`
- ✅ v1.1.0 已發佈
- ✅ SRS v1.1（Verbosity Modes）— `doc/phase-1-analysis/srs.md`
- ✅ SDD v3.0（Verbosity Modes）— `doc/phase-2-design/sdd.md`
- ✅ 測試報告 v1.1 — `doc/phase-4-qa/test-report.md`
- ✅ Release Notes v1.2.0 — `doc/phase-5-delivery/release-notes.md`
- ✅ v1.2.0 已 commit（`4b87e5d`，待 push）
- ✅ SRS v1.2（Interactive Permission）— `doc/phase-1-analysis/srs.md`
- ✅ SDD v4.0（Interactive Permission）— `doc/phase-2-design/sdd.md`
- ✅ 測試報告 v1.2 — `doc/phase-4-qa/test-report.md`
- ✅ Release Notes v1.3.0 — `doc/phase-5-delivery/release-notes.md`
- ✅ v1.3.0 已 commit（`59d6e63`，待 push）

## 快速指令

- **Build**：`npm run build`
- **Dev**：`npm run dev`
- **Test**：`tsc --noEmit`

## 深度上下文（需要時再讀）

- 完整執行日誌：`.claude/execution-log.md`
- 歸檔日誌：`.claude/execution-log-archive/`
- SRS：`doc/phase-1-analysis/srs.md`
- SDD：`doc/phase-2-design/sdd.md`
