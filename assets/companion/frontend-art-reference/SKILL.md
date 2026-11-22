---
name: frontend-art-reference
description: Use when starting any frontend, UI, or visual design work (web page, landing page, dashboard, admin panel, app screen, game HUD, slide deck, poster, illustration, icon, color scheme, motion or transition) — pull concrete references from the dsh-anim-pack library before writing markup or CSS: animation styles, shot recipes, pixel effects, palettes and layout rules. 触发场景：做前端/网页/落地页/仪表盘/后台/App 界面/游戏 UI/HUD/PPT/海报/插画/图标/配色/动效/转场，动手写代码或排版之前先取参考。
---

# 前端设计：先取参考，再动手

<!-- managed by dsh-anim-pack tools/install.mjs -->

## 什么时候用

只要任务里出现「页面 / 前端 / UI / 界面 / 落地页 / 看板 / 后台 / App / 游戏 HUD /
PPT / 海报 / 插画 / 配色 / 动效 / 转场 / 图标」这类词，**先取参考，不要凭空写样式**。
哪怕是改一个小卡片，也值得先看一眼配色与动效预算。

## 第一步：一次调用拿参考包

用 anim_design_brief 把场景、情绪、配色倾向一次说清：

- `anim_design_brief(task="深色科技风的 AI 写作产品落地页")`
- 已知场景时补 surface（web-landing / dashboard / app / game-ui / deck / promo / illustration），
  它比从任务描述里猜更准：`anim_design_brief(task="…", surface="dashboard")`
- 想要固定感觉就写 mood（克制冷灰、暖米白、胶片复古、活泼明亮、国风宣纸…），
  已有品牌色就写 palette。

返回里依次是：① 3 条风格选型（含 anim_show 调用）② 3–6 张镜头配方卡
（含 anim_shot_show 调用）③ 像素特效候选 ④ 配色方案 + 版式 + 动效硬指标
⑤ 下一步调用顺序。**照第 ⑤ 节调 2–3 次就够，不要一口气全读。**

## 第二步：按需深读

- 定基调、配色、质感 → `anim_show(id="…")`（341 条代码动画风格提示词）
- 动效/转场/数据动画的节奏与参数 → `anim_shot_show(id="…")`，
  想看画面就 `anim_shot_preview(ids=[...])`（一次最多 12 张海报）
- 要能直接跑的动画代码 → `anim_fx_show(id="…")`，要落地就
  `anim_fx_export(ids=[...], dir="<项目里的目录>")`
- 找实拍/绘画参考图 → `anim_ref_search(query="…", download=true)`（需自建素材库）
- 要配图 / 图标 / PBR 贴图 / 纹理 / 色板 → 先 `anim_asset_sources` 看有哪几家，
  再 `anim_asset_search(query="…", category="…")`；挑定一条用 `anim_asset_show(id)`
  确认授权，要本地文件再 `anim_asset_fetch(id, dir="<项目里的 assets 目录>")`。
  许可不明或 © 的只当参考看，别直接进交付物。

## 硬规矩

- 这些是**参考**，不是模板：抄参数与节奏，不抄整段代码；镜头卡里的「上游实现」是
  Remotion 仓库路径，不在本机，别照着 import。
- 配色按 60/30/10 分配（底色/面/强调），一屏只留一个动效主角。
- 深色系页面先定底色再定强调色；不要同时上两种高饱和强调色。
- 用户没给方向时：先给 2 个方向（一冷一暖）让他选，再展开。
