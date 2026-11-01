# pixelfx 特效库：244 个「一段代码就是特效」的像素动画

这个插件原来只有 341 条**风格提示词**（教你怎么画）。现在多了第二个数据源：
镜像进来的 [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) —— 244 个**已经写好的特效代码**，
每个都是纯 JavaScript、零依赖、跑在 canvas 上。两边分工：

| | anim_* 提示词库 | anim_fx_* 特效库 |
|---|---|---|
| 是什么 | 怎么画（描述 + 参考静帧） | 画好了（可运行代码 + 预览图） |
| 数量 | 341 条 / 193 张静帧 | 244 个 / 244 张接触表 / 21 个分类 |
| 怎么用 | 读提示词，自己写代码 | 直接 import，或导出精灵表 |
| 授权 | 见 docs/attribution.md | MIT（代码与特效） |

镜像位置：工作区里的 `pixelfx/`（提交 `a841596` = v0.3.0，2026-10-31）。

---

## 一、七条工具

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `anim_fx_stats` | 家底：244 个特效、21 个分类各多少个、多少带角色表演 / 循环 / 预览、上游提交与许可 | 第一次接触，先看有什么 |
| `anim_fx_search` | 按关键词 / 分类 / 循环 / 角色检索，返回 id、名称、标签、尺寸、时长、是否循环、是否有角色 | "有没有冰霜系的？" |
| `anim_fx_preview` | 给出预览接触表 PNG 的本地路径（一次最多 12 个） | 挑之前先看图 |
| `anim_fx_show` | 单个特效的说明书：元信息、可调色带、act 表演时间轴、现成接入代码，`source: true` 附源码 | 决定要用它了 |
| `anim_fx_export` | 把选中的特效 + 运行时的 `src/core` + 渲染工具 + 许可证复制成一个能直接跑的小项目 | 要拿去用 |
| `anim_fx_random` | 随机抽一个并给出说明书（可限定分类） | 找灵感 |
| `anim_fx_guide` | 就是本篇 | 忘了怎么用 |

## 二、典型流程（挑一个现成的用）

```
anim_fx_stats()                                  # 21 个分类的家底
anim_fx_search(query="冰", category="ice")        # 定位到 ice/frost-nova
anim_fx_preview(id="ice/frost-nova")             # 拿到接触表路径，看图
anim_fx_show(id="ice/frost-nova")                # 时长、act 打击点、可选色带、接入代码
anim_fx_export(ids=["ice/frost-nova"], dir="D:/game/fx")
```

导出目录长这样（`runtime: true` 时）：

```
fx/
  src/core/              引擎：color + light 两套缓冲、Painter、sim、rig/act
  src/fx/ice/frost-nova.js    特效本体
  src/fx/ice/_lib.js     同分类共用函数（这个特效用到了才复制）
  tools/render.mjs       渲染工具
  tools/lib/fxlib.mjs    渲染辅助
  tools/lib/png.mjs      零依赖 PNG 编码器
  LICENSE  NOTICE.md  README.md  package.json
```

不需要 `npm install`，在导出目录里直接：

```bash
node tools/render.mjs ice/frost-nova --zoom 2     # 接触表 → records/ice/frost-nova/contact.png
node tools/render.mjs ice/frost-nova --sheet      # 精灵表 PNG + Aseprite 风格 JSON
node tools/render.mjs --help
```

## 三、在游戏 / 网页里接

每个特效都是 `{ meta, init?, update, draw }` 形状；宿主只负责喂 `dt` 和把两套缓冲合到屏幕上。
**关键点是两套缓冲**：`frame.color`（像素本体，带 alpha/抖动）和 `frame.light`（加色光晕，叠在最上面），
`composite()` 先 color 再 light，这样火、闪电能真的"照亮"背景，而不是贴一层半透明白。

```js
import { createFrame, clearFrame, createFx, composite } from './src/core/index.js'
import * as frostNova from './src/fx/ice/frost-nova.js'

const frame = createFrame(288, 192)
const img = new ImageData(288, 192)          // 浏览器；Node 里换成 Uint8ClampedArray
const fx = createFx(frostNova, { x: 144, y: 150 })   // x/y 是 origin（地面锚点）

function tick(dt) {
  fx.update(dt)                // 内部按 120Hz 定步长推进，帧率无关
  clearFrame(frame)
  fx.draw(frame, 'back')       // 角色背后那层
  drawYourCharacters()         // 你的角色
  fx.draw(frame, 'front')      // 角色前面那层
  composite(frame, img.data, '#12111a')   // 背景色（或传 null 保持透明）
  ctx.putImageData(img, 0, 0)
}
```

几个常用事实：

- **循环**：`meta.loop === true` 的可以一直挂着；单次的跑完 `fx.done()` 变 true，`stop()` 立即收尾。
- **换色**：`meta.options.palette` 是色带，`createFx(mod, { palette: ['#102','#215','#43a','#8cf','#cff','#fff'] })`
  能把火焰变成冰焰，长度不同会自动重采样到默认档数。
- **跟着角色走**：`meta.actor` 为真的特效画了 24×38 的小人（`src/core/rig.js` 真骨骼 + IK，
  `act.js` 按 12fps 姿态关键帧表演），`act.hits` 里的 `t/freeze/shake` 就是打击感参数。
- **分辨率**：`meta.size` 是设计尺寸，整数倍放大最清晰（`nearest` 采样）。

## 四、给非 JS 引擎（Godot / Unity / GameMaker / LÖVE）

不要移植代码，走精灵表：

```bash
node tools/render.mjs melee/sword-slash --sheet
```

输出 PNG（透明背景） + 同名 JSON：帧矩形、`frameSize`、`pivot`、`columns`，以及
`meta.pixelfx.act`（蓄力时长、每个打击点的 t / 顿帧 / 震屏、换皮时刻）——
引擎那边按 JSON 切帧、按 act 安排受击反馈即可。

## 五、自己写新特效

在镜像仓库里（`pixelfx/`）：

```bash
node tools/new.mjs fire/my-spark --loop     # 生成骨架（kebab-case，分类必须已有）
node tools/render.mjs fire/my-spark --zoom 2   # 渲出来看
node tools/check.mjs fire/my-spark         # 质检：调色板空洞、越界、循环接缝、确定性、单帧耗时
node tools/index.mjs                       # 更新 src/fx/index.js 与 docs/CATALOG.md
```

常见坑（`docs/AUTHORING.md` 里有完整约定）：

- 只用 `src/core` 里的东西，别直接碰 DOM / canvas / `Math.random`（检查项会拦）。
- 坐标是**局部坐标**，原点在特效脚下；画布外 24px 内不得有东西漏出去。
- 单次特效在 `t = duration` 时必须自己清干净。
- 一帧中位耗时 ≤ 4ms（`check.mjs` 会量）。
- 只要线条和光，不要糊大片实色；免费加光靠 `painter.glow() / painter.glowLine()`。

写完别忘了回到插件目录重建索引，否则 `anim_fx_search` 看不到它：

```bash
node tools/build-fx.mjs --previews
```

## 六、许可与署名（用之前看一眼）

- 代码与 244 个特效：**MIT**，© 2026 rehan-remade。
- `sim.js` 以及 180 个标注了的特效改编自 Hugo Duprez / **Sprite Fusion** 的 pixel-art-vfx（MIT）。
- `act.js` 改编自同作者的 **Hollow Crown**（MIT）。
- 唯一例外：`gallery/fonts/PatchPixel-Regular.woff2` 是 Patch 自有字体，**不是 MIT**，仅随仓库用作展示；
  插件不带这个字体，导出也不复制它。

导出的小项目里会带上 `LICENSE` 与 `NOTICE.md`，发布时一起带着就行。

## 七、维护（升级上游 / 重建索引）

```bash
cd pixelfx
git pull                                    # 上游更新（当前是浅克隆，必要时 git fetch --unshallow）
cd ../dsh-plugins/dsh-anim-pack
node tools/build-fx.mjs --previews --force  # 重建 assets/fx/catalog.json 与 244 张预览
node tools/verify.mjs                       # 插件自身冒烟测试
```

索引文件 `assets/fx/catalog.json` 是**构建快照**：宿主进程不 import 别人的 244 个模块，
只读 JSON、源码文本和已渲染的 PNG。所以改了特效文件、却没重跑 `build-fx`，工具看到的就是旧数据。

已知限制（实测）：

- 预览图 244 张共 ~24MB，随插件一起分发；只想省空间可以删 `assets/fx/previews`，`anim_fx_preview` 会提示重渲。
- 9 个特效实测单帧 >4ms（`weather/storm-cloud` 6.4ms 最慢），手机端要降分辨率。
- 特效是按 24×38 的小人画的；大尺寸角色要么整体放大，要么当纯特效（不画角色）用。
- 索引里的 `repo` 记的是构建时的绝对路径；镜像搬过家就用配置 `fxPath` 指过去，或重建索引。
