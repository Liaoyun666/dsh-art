# 镜头配方卡：怎么用（video-shotcraft）

这组工具接进来的是 [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)
的**镜头配方卡**——不是视频生成模型，也不是模板文件，而是 124 张「这一幕怎么动」的施工图。
上游用 Remotion（React 写视频）把产品宣传片逐帧画出来；这些卡负责回答
「开场用什么、转场怎么切、数字怎么滚、收尾怎么停」。

| 事实 | 数字 |
|---|---|
| 配方卡 | 124 张（`assets/shots/cards/<分类>/*.md`） |
| 上游镜头风格 | 150 个（一张卡可以覆盖同族的两三个变体） |
| 分类 | 10 个 |
| 海报（gallery 静帧） | 54 张（`assets/shots/posters/*.jpg`） |
| 索引 | `assets/shots/index.json`，`node tools/build-shots.mjs` 生成 |

在线样片：<https://vincentwei1021.github.io/video-shotcraft/>

## 一、一张卡里有什么

frontmatter 六个字段（124 张都有前五个，标签只有 50 张有）：

| 字段 | 意思 |
|---|---|
| `name` | 卡片 id（英文短横线） |
| `一句话` | 这一镜看完是什么样，直接当标题用 |
| `适用` | 放在片子的哪一段、替掉什么 |
| `时长` | 帧数与秒数（还写着关键拍的分配） |
| `能量` | 低 / 中 / 高，用来排全片的起伏 |
| `标签` | 可选，`typography`、`3d` 之类 |

正文固定六段：

1. **意图**——为什么这样动，观众该看到什么；
2. **动效核心**——真正要写进代码的配方（缓动、偏移、层级、遮罩）；
3. **参数表**——可以直接改的数（字号、位移、帧数、延迟），这是最值钱的部分；
4. **声音**——卡点、拟音、留白；
5. **已知坑**——上游踩过的坑（掉字、糊边、掉帧、导出不对）；
6. **参考实现**——上游 Remotion 文件路径，比如
   `demos/typography/brand-ink-open/BrandInkOpen.tsx`。

⚠️ 本插件**只带卡和海报**，不带 Remotion 工程、不带样片 MP4、不带音效。
「参考实现」那行是给你去上游取代码的地址；不装 Remotion 也能照参数表在本机重做。

## 二、十类怎么分工

| 分类 | 卡 | 风格 | 干什么 |
|---|---|---|---|
| `opening` 开场与品牌 | 11 | 11 | 先立名号：字标、准星、图标场 |
| `camera` 运镜与空间 | 10 | 13 | 2.5D 推拉摇移、卡片进 3D、拆解 |
| `transition` 转场 | 15 | 19 | 卡片群、遮罩、翻页、闪切、隐形切 |
| `typography` 文字与字卡 | 22 | 25 | 文字隧道、逐字、字重字号表演 |
| `ui-entrance` 界面登场 | 21 | 22 | 页面/卡片/面板怎么进画 |
| `interaction` 交互演示 | 11 | 13 | 点击、拖拽、换主题的真反馈 |
| `data` 数据与指标 | 5 | 9 | 数字滚动、点阵重组、轴重标 |
| `effects` 光效与强调 | 15 | 23 | 聚光、闪、glint、粒子 |
| `rhythm` 节奏与蒙太奇 | 8 | 8 | 卡点闪切、分镜格、多裁切 |
| `outro` 收尾 | 6 | 7 | 归位、拼标、留白与 CTA |

排一条 15–30 秒的产品片，通常是
**opening 1 张 → ui-entrance / interaction 2–3 张 → data 1 张 → transition 2 张穿插 → outro 1 张**，
中间用 `rhythm` 的卡控节奏、用 `effects` 抬重点。

## 三、七条工具

| 工具 | 干什么 |
|---|---|
| `anim_shot_stats` | 看家底：分类、每类卡数/风格数/海报数、能量分布、上游地址 |
| `anim_shot_search` | 按关键词 / 分类 / 标签 / 能量 / 有无海报检索；关键词会进正文（`deep: false` 关掉） |
| `anim_shot_show` | 读一张卡的全文（摘要 + 六段 + 上游实现路径） |
| `anim_shot_preview` | 给海报的本地 JPG 路径，交给看图工具，一次最多 12 张 |
| `anim_shot_export` | 把卡 + 海报复制成 `<卡名>/` 目录，附 README 与 `index.md` 总表 |
| `anim_shot_random` | 随机抽一张，可限定分类 / 标签 / 能量 / 有海报 |
| `anim_shot_guide` | 就是本文件 |

检索默认「每词都必须命中」：`镜像 开场` 只会回同时沾这两个词的卡。
搜不到时先 `anim_shot_stats` 看分类名，再用 `category` 限定。

## 四、从挑卡到成片

1. **定骨架**：先写这一条片有几幕、每幕几秒、能量怎么爬。
   `anim_shot_stats` 看分类，`anim_shot_search(category="opening")` 铺开候选。
2. **读配方**：`anim_shot_show` 看意图与参数表；`anim_shot_preview` 看海报确认观感。
   海报只有 54 张——没图的卡不是坏卡，是上游没截帧，看在线样片。
3. **落成代码**（三选一）：
   - 装了 video-shotcraft：照卡里「参考实现」路径去 `demos/` 取现成 Remotion 组件；
   - 不装 Remotion：按「动效核心 + 参数表」在 AE / Rive / Lottie / 自己的渲染器里重做；
   - 只做分镜：`anim_shot_export` 把卡导进工作目录，当分镜脚本交给剪辑。
4. **导出交活**：`anim_shot_export(ids=[...], dir="storyboards/2026-11")`
   会得到每张卡一个目录（md + jpg + README）加一份 `index.md`。

## 五、和另外四组数据源怎么搭

| 数据源 | 配合方式 |
|---|---|
| 341 条风格提示词（`anim_search`） | 卡定「怎么动」，提示词定「长什么样」：先用卡选镜头，再用 `anim_show` 取美术风格词 |
| 244 条像素特效（`anim_fx_*`） | 卡里的「光效/强调」需要现成代码时，`anim_fx_search` 找对应特效直接接 |
| 自建参考图库（`anim_ref_*`） | 卡的海报不够用时，按卡标题里的关键词去参考图库找构图 |
| 元素提取（`anim_extract`） | 手上只有一张静帧时，先拆元素与配色，再照卡重排成动效 |

## 六、卡不覆盖的事

- **声音**：卡里只有「该在哪个拍上响」，音效与 BGM 在上游 `assets/audio`（本插件不带）。
- **Remotion 工程**：模板、组件、渲染脚本都在上游仓库，本插件不镜像。
- **剪映工程导出**：上游做了，Mac 实测、Windows 未验证；本插件不掺和。
- **竖屏适配**：多数卡按 16:9 写的，竖屏要重算安全区（卡里「已知坑」常会提醒）。

## 七、许可与维护

- 卡片与海报来自 video-shotcraft，**Apache-2.0**，© 2026 Vincentwei1021；
  卡片正文按原文收录（未改写），署名见仓库根目录 `NOTICE.md`。
- 卡片文件不要手改——重跑 `node tools/build-shots.mjs` 会以卡片为准重建索引；
  想改配方就在导出目录里改自己那份。
- 更新上游：把 `references/shots/` 与 `gallery/media/poster/` 重新取下来覆盖，
  再跑 `node tools/build-shots.mjs --commit <上游 commit>`；`--check` 用来确认索引与卡片一致。
- 新增卡片：放进 `assets/shots/cards/<分类>/`，同一张卡的海报同名放 `assets/shots/posters/`，
  重跑构建脚本即可；上游有 4 张海报用的是镜头风格名而不是卡片名，
  别名表在 `tools/build-shots.mjs` 的 `POSTER_ALIAS` 里。
