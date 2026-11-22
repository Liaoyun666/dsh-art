# 素材与许可

本技能封装的是随项目提供的「代码动画_341种风格提示词_免费」素材包。原作者的说明、所有风格文件、示例与许可保留在 `../assets/library/`。XiaoyeCodes 负责本仓库的技能封装、检索／安装／渲染脚本和展示文档，不将素材包中的全部作品声明为自己的原创。

- [原始说明](../assets/library/说明.md)：免费使用、免费转发；禁止将这些内容包装成课程、付费 skills 或其他收费内容出售。
- [原始来源说明](../assets/library/许可与来源.md)：原整理者对自制／改写部分的说明。
- [Lemo-Opuscar](../assets/library/第三方许可/Lemo-Opuscar_LICENSE.txt)：MIT，Copyright (c) 2026 LemoLab。
- [mg-styles-15](../assets/library/第三方许可/mg-styles-15_LICENSE.txt)：MIT，Copyright (c) 2026 Vincentwei1021。
- [code-video](../assets/library/第三方许可/code-video_LICENSE.txt)：MIT，Copyright (c) 2026 Bae-ChangHyun。

## pixelfx 像素特效（第三个数据源）

像素特效源码与 244 条元信息镜像自 [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx)，
**代码与特效均为 MIT**（见镜像里的 `LICENSE` / `NOTICE.md`，导出时一起复制）：

- `src/core/sim.js` 与 180 个特效改编自 Sprite Fusion 的开源像素特效
  （<https://www.spritefusion.com/pixel-art-vfx>，Copyright (c) 2026 Hugo Duprez，MIT）。
- `src/core/act.js` 改编自 [hollow-crown](https://github.com/rehan-remade/hollow-crown)
  （Copyright (c) 2026 rehan-remade，MIT）——12 fps 姿态步进、打击顿帧、弹簧稻草人。
- 字体 `gallery/fonts/PatchPixel-Regular.woff2` 是 Patch 自有字体，**不在 MIT 覆盖范围内**
  （© 2026 Patch，保留所有权利）。本插件只镜像特效源码与工具，不分发该字体。

## 远端参考图库

感谢原素材整理者——哔哩哔哩 [**俯仰观照**](https://space.bilibili.com/3690990015613855/?spm_id_from=333.788.upinfo.detail.click) 的资源分享。

不同来源的内容保留各自许可。免费分享约定不改写第三方 MIT 文本；整个合集不能简单标成全部 MIT。电影、艺术风格与示例名称是参考描述，不代表官方合作或背书。

## 元素提取用到的解码器（第四个数据源）

`anim_extract` 要读用户手上的图，PNG / GIF / BMP / TGA 的解码是自己写的（`lib/image.js`），
**JPEG 用了 vended 的 jpeg-js**（`lib/vendor/jpeg-decoder.js`，jpeg-js 0.4.4 的 `lib/decoder.js` 原文，
只加了一行 `export { decode }`）：

- jpeg-js：BSD-3-Clause，Copyright (c) 2014 Eugene Ware（<https://github.com/jpeg-js/jpeg-js>）。
  原文见 `lib/vendor/LICENSE-jpeg-js.txt`。
- 其解码核心源自 notmasteryet 的 JPEGDecoder：Apache-2.0，Copyright (c) 2011 notmasteryet。
  原文见 `lib/vendor/LICENSE-apache-2.0.txt`。

没有引入其他运行时依赖：不联网、不装包，其余格式的解码器（PNG 的 zlib 展开、GIF 的 LZW、
BMP / TGA 的位深与 RLE）都是本仓库自己实现的。
## video-shotcraft 镜头配方卡（第五个数据源）

124 张镜头配方卡与 54 张 gallery 海报收录自
[Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（Copyright (c) 2026 Vincentwei1021），
**Apache-2.0** 许可，原文见 [NOTICE.md](../NOTICE.md) 第 4 节。

- 收的是**卡片正文**（Markdown）与海报（JPG），不是它的 Remotion 工程：仓库里没有该项目的 `template/`、`demos/`、
  样片 MP4、音效与 BGM，也没有改写过卡片文字。
- 每张卡里的「参考实现」路径指向上游仓库内的文件位置，只作线索；本地没有这些源码。
- 索引 `assets/shots/index.json` 由本仓库的 `tools/build-shots.mjs` 从卡片 frontmatter 生成，可随时重建。
- 上游 4 张海报用的是「镜头风格名」而不是卡片名，本仓库按 `tools/build-shots.mjs` 里的 `POSTER_ALIAS`
  对到卡片上，并在注释里写明映射关系。

## 设计工艺库（第六个数据源）

`assets/design/` 的四份 JSON 与 `catalog.json` 是**按上游要点重新译写**的中文数据，
不是上游文件的原样复制；三个上游都是 MIT，可以改写与再分发，但需保留署名：

- **八条美学锚点**、内容纪律与「发货前五项自检」→ [Ilm-Alan/frontend-design](https://github.com/Ilm-Alan/frontend-design)（MIT）。
- **24 条 CSS 版式模式**、5 套配色原型、5 组字体配对、7 条排版层级、5 档动效时长 → [MickeyAlton33/web-designer-plugin](https://github.com/MickeyAlton33/web-designer-plugin)（MIT）。
- **15 条可用性准则**与 0–4 严重度 → [mistyhx/frontend-design-audit](https://github.com/mistyhx/frontend-design-audit)（MIT）。

原文见 [NOTICE.md](../NOTICE.md) 第 6 节。三个仓库的 SKILL.md、长文档与示例页面没有收录；
`patterns.json` 里的 CSS 是摘写后的片段，抄进项目前要换成项目自己的 token 名。
## 外接素材库（第七个数据源，素材不随包发）

这一组特殊：**仓库里没有任何一条素材文件**，插件只做检索、展示授权、下载。
代码（`lib/assets.js`）是本仓库自己的 MIT 代码；素材的权利仍归各家，插件不转授。

- **[liaoyunart.com](https://liaoyunart.com)**（`liaoyunart`）：自建美术参考图库，聚合 21 个公共来源
  （The Met、Cleveland、Rijksmuseum、SMK、V&A、Europeana、Wellcome、NASA、Iconify、ambientCG、
  Poly Haven、Lospec、OpenGameArt、unDraw、PhyloPic、SafeBooru 等），16,907 条。
  目录里每条都带 `lic`（授权文案下标）与来源页，工具按 CC0 / 署名 / 非商业 / 不明四档标出；
  **这个库是聚合器，不是权利人**，具体条目以它标的那一条授权为准。
- **[Iconify](https://iconify.design)**：280 个图标集、55 万+ 图标，授权按集合（多数 MIT / CC BY / Apache-2.0），
  检索时会一并返回集合许可；SVG 由 API 现取。
- **[ambientCG](https://ambientcg.com)**：2,939 套 PBR 材质，**CC0**。
- **[Poly Haven](https://polyhaven.com)**：HDRI / 纹理 / 模型，**CC0**。
- 只登记入口的九家：Kenney（CC0）、OpenGameArt（逐条）、LottieFiles（逐条）、game-icons（CC BY 3.0）、
  Google Fonts（OFL / Apache）、Hero Patterns（CC BY 4.0）、Transparent Textures（CC BY 3.0）、
  Lospec（逐条）、unDraw（品牌条款特殊）——各家的授权写在 `lib/assets.js` 的 `PROVIDERS` 与
  [assets.md](assets.md) 里，使用前按各家原文核对。

**落地纪律**：做交付物前按每条自己的授权判断，不把「这个库大多 CC0」当成「这张也 CC0」；
署名类要写出处与许可；非商业不进商业项目；© 或不明只当参考。
