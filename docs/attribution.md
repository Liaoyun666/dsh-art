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
