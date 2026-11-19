# NOTICE

本仓库包含三种不同许可的内容，逐项列在下面。

## 1. 插件代码 —— MIT

`lib/`、`tools/`、`docs/`、`package.json`、`cordis.patch.yml`：MIT，© 2026 Liaoyun666，全文见 [LICENSE](LICENSE)。

> `LICENSE` 里是标准 MIT 全文，只针对上面这些代码文件；`assets/` 下的两类素材各按本文件第 2、3 节处理。

### 第三方解码器（`lib/vendor/`，不在 MIT 覆盖内）

`anim_extract` 读 JPEG 用的是 [jpeg-js](https://github.com/jpeg-js/jpeg-js) 0.4.4 的 `lib/decoder.js`
原文（只加了一行 `export { decode }`）：

- jpeg-js —— **BSD-3-Clause**，© 2014 Eugene Ware，原文见 `lib/vendor/LICENSE-jpeg-js.txt`。
- 其解码核心来自 notmasteryet 的 JPEGDecoder —— **Apache-2.0**，© 2011 notmasteryet，
  原文见 `lib/vendor/LICENSE-apache-2.0.txt`。

PNG / GIF / BMP / TGA 的解码与编码、全部分析算法都是本仓库自写，随 MIT 代码发布。

## 2. 风格提示词素材 —— 原条款

`assets/library/`（341 条风格提示词、193 张参考静帧、示例视频与截图）：

- **可以**免费使用、免费转发、改着用。
- **不可以**包装成课程、付费 skills 或其他收费物出售。
- 来自开源项目的部分保留原许可与署名（见下）。
- 条款原文：`assets/library/许可与来源.md` 与 `assets/library/说明.md`。

### 第三方（均 MIT，原文在 `assets/library/第三方许可/`）

| 项目 | 版权 |
|---|---|
| code-video | © 2026 Bae-ChangHyun |
| Lemo-Opuscar | © 2026 LemoLab |
| mg-styles-15 | © 2026 Vincentwei1021 |

### 关于静帧

193 张静帧是**代码渲染或 AI 生成的插画**，不是影片截帧——
`O_奥斯卡98部` 系列只是用 98 部奥斯卡影片当**风格参照**，图是按风格重画的插画
（例如 `O55_甘地传` 画的是一场带红色吉祥物角色的风格化插画）。
`assets/library/示例/` 里的两个 MP4 是同一份提示词分别在 DeepSeek-V4.1-Flash 与 Opus5.5 下生成的成片，
随提示词一并附上。

## 3. pixelfx 像素特效 —— MIT

`assets/fx/catalog.json`（244 条索引）与 `assets/fx/previews/`（244 张接触表 PNG）由
[patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) 生成，MIT。
上游自己也带完整署名，摘录如下：

- **sim.js 与其中约 180 个特效**改编自 [Sprite Fusion · pixel-art-vfx](https://www.spritefusion.com/pixel-art-vfx)，
  © 2026 Hugo Duprez，MIT。
- **act.js**（骨架 + 表演层）改编自 [Hollow Crown](https://github.com/rehan-remade/hollow-crown)，MIT。
- **创作方法论**（先找参考 → 一根线 → 渲出来看 → 定基准 → 至少三轮）同样来自 Sprite Fusion。

### 字体例外（不在本仓库内）

pixelfx 上游的 `gallery/fonts/PatchPixel-Regular.woff2` 是 Patch 自己的字体，
**© 2026 Patch，保留所有权利，不是 MIT**。本仓库不包含该字体文件；
`assets/fx/previews/` 里的字是渲染工具内置的点阵字体（`src/core/font.js`）画的。

## 4. 镜头配方卡 —— Apache-2.0

`assets/shots/cards/`（124 张镜头配方卡）与 `assets/shots/posters/`（54 张 gallery 海报）
来自 [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)，
**Apache-2.0**，© 2026 Vincentwei1021。卡片正文按原文收录，未改写；
索引 `assets/shots/index.json` 由 `tools/build-shots.mjs` 从卡片重新生成，同样随上游许可发布。
本仓库不包含上游的 Remotion 工程、样片视频、音效与 BGM；卡片「参考实现」里写的是
去上游取代码的相对路径。上游许可原文见其仓库 `LICENSE`。

## 5. 参考图库（可选，不在本仓库内）

`anim_ref_*` 四条工具连接的是**使用者自己部署的**参考图库（只读 JSON API），
图片版权归各自来源（Met、SafeBooru、V&A、Iconify、ambientCG、NASA、Wellcome 等），
本仓库不分发任何一张参考图。

## 6. 设计工艺库 —— MIT（译写，不是原文件）

`assets/design/` 下的四份 JSON（`anchors.json` / `patterns.json` /
`heuristics.json` / `rules.json`）与索引 `catalog.json` 是**按上游要点重新译写**的中文
数据，不是上游文件的原样复制。来源与许可：

- 八条美学锚点（Swiss / Industrial / Brutalist / Aurora Maximalism / Chaotic Maximalism /
  Retro-Futuristic / Organic / Lo-Fi）与内容纪律：来自
  [Ilm-Alan/frontend-design](https://github.com/Ilm-Alan/frontend-design)，**MIT**。
- 24 条 CSS 版式模式、配色原型、字体配对与动效时长：来自
  [MickeyAlton33/web-designer-plugin](https://github.com/MickeyAlton33/web-designer-plugin)，**MIT**。
- 15 条可用性准则、0–4 严重度与反 AI 味清单：来自
  [mistyhx/frontend-design-audit](https://github.com/mistyhx/frontend-design-audit)，**MIT**。

改数据时连同 `lib/design.js` 的检索逻辑一起改，并跑 `node tools/build-design.mjs`
重建 `catalog.json`。三个上游的 SKILL.md / 长文档没有收录。
