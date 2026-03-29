# claude-discord (Multi-Platform Bot)

> 本檔案由 PM 自動維護，每次 Phase 轉換和重大決策時更新。
> 最後更新：2026-03-29

## 當前狀態

- **版本**：v1.1.0（已發佈）
- **進行中功能**：Verbosity Modes（訊息顯示層級控制）
- **Phase**：PHASE_1_ANALYSIS（10%）
- **當前 Step**：Step 1.1 — SA 需求分析（Verbosity Modes）
- **阻塞事項**：無
- **下一步**：SA 產出 SRS 增量版 → Architect 可行性評估

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

## 已完成交付物

- ✅ SRS v1.0（Slack 擴充）— `doc/phase-1-analysis/srs.md`
- ✅ 可行性報告 v1.0 — `doc/phase-1-analysis/feasibility-report.md`
- ✅ SDD v2.0（Slack 擴充）— `doc/phase-2-design/sdd.md`
- ✅ Release Notes v1.1.0 — `doc/phase-5-delivery/release-notes.md`
- ✅ v1.1.0 已發佈
- ⏳ SRS v1.1（Verbosity Modes）— 進行中

## 快速指令

- **Build**：`npm run build`
- **Dev**：`npm run dev`
- **Test**：`tsc --noEmit`

## 深度上下文（需要時再讀）

- 完整執行日誌：`.claude/execution-log.md`
- 歸檔日誌：`.claude/execution-log-archive/`
- SRS：`doc/phase-1-analysis/srs.md`
- SDD：`doc/phase-2-design/sdd.md`
