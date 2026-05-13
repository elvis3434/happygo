# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HappyGo — 台灣樂透開獎模擬器，支援今彩539、大樂透、威力彩三種玩法。純前端應用，使用 Matter.js 2D 物理引擎模擬球在圓形容器內碰撞。

## Commands

- `npm run dev` — 啟動 Vite dev server (port 5173)
- `npm run build` — TypeScript 編譯 + Vite production build，輸出至 `dist/`
- `npm run preview` — 預覽 production build

Build 產物為純靜態檔案（HTML + JS + CSS），可直接開啟 `dist/index.html` 離線使用。

## Architecture

- **index.html** — 入口，載入 `src/main.ts`
- **src/main.ts** — UI 骨架（模式選擇按鈕、結果展示區、控制按鈕），實例化 `LotteryMachine`
- **src/LotteryMachine.ts** — 核心邏輯：
  - Matter.js Engine 管理物理世界（重力、碰撞）
  - 圓形容器用 64 段矩形牆壁組成
  - 攪拌棒（stirrer）為旋轉的靜態矩形體，驅動球碰撞
  - 狀態機控制流程：idle → filling → mixing → drawing → done（威力彩多 round2 系列狀態）
  - Canvas 2D 手動渲染（不用 Matter.js Render），球帶漸層光澤和號碼文字
- **src/style.css** — 全局樣式，深色主題

三種玩法差異僅在 `MODE_CONFIGS` 設定（球數、抽出數），威力彩額外有 `SUPER_ROUND2` 第二輪配置。
