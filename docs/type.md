# 文字与前端美化（第八个数据源）

> V1.1 起的第 8 个数据源：180 条配方 + 71 条字体种子，10 个 `anim_*` 工具。
> 目的很直白——模型做前端/海报/PPT 时，标题、装饰、背景、字体、图标、配色都有现成东西可抄，不用每次从零调 CSS。

## 数据长什么样

数据随包发在 `assets/type/`，六份 JSON（`version` / `generatedAt` / `count` / `entries`）：

| 文件 | 条数 | 内容 | 典型 id |
| --- | --- | --- | --- |
| `effects.json` | 37 | 艺术字与文字特效（空心、硬投影、渐变切图、金属、噪点、挤压、等距、霓虹、玻璃、RGB 分离、扫描线、湍流、80s 镀铬、套色错位、印章、做旧、马克笔、圈注、胶带、便签、像素、CRT、HUD、描边动画、混排、竖排、等宽数字、双色叠加…） | `vertical` / `neon-glow` / `tabular` |
| `motion.json` | 16 | 文字动效（逐字入场、打字机、数字滚动、描边书写、遮罩擦除、模糊聚焦、故障闪现、波浪、翻牌、渐变流动、下划线生长、跑马灯、光标、解码、3D 倾斜） | `typewriter` / `count-up` |
| `decor.json` | 32 | 装饰件（分隔线、边框、花边、纹理、光效、贴纸：波浪、撕纸、票券、拍立得、纸纹、网格、蓝图、聚光、光球、胶带、邮戳、吊牌、绶带、气泡、便签、手绘箭头、圈选、爆炸星标） | `torn-paper` / `sticker-tape` |
| `background.json` | 14 | 背景预设（mesh 渐变、极光、噪声渐变、网格、点阵、蓝图、纸纹、星空、波浪、锥形、聚光、斜纹、半调、等高线），每条带 `defaults` 与 `{c1}{c2}{c3}{base}` 占位 | `mesh` / `aurora` / `halftone` |
| `illustration.json` | 10 | 插画站外接（unDraw、Storyset、Open Doodles、Humaaans、Drawkit、IRA Design、Blush、Open Peeps、ManyPixels、illllustrations）：站点、许可、怎么接 | `undraw` |
| `fonts.json` | 71 | 字体种子（Google 51 / Fontshare 13 / 系统 7；含 15 条中文字体），字段 `family` / `source` / `category` / `cjk` / `weights` / `license` / `pair` / `note` | `Noto Sans SC` / `Satoshi` |

每条配方字段：`id` `name` `category` `when`（什么时候用）`tags` `params` `html` `css` `pitfall`；背景与字体字段略有差别（背景有 `defaults` 与 CSS 模板，字体有 `source` / `weights` / `license`）。

## 十个工具

| 工具 | 什么时候调 | 给什么 |
| --- | --- | --- |
| `anim_type_stats` | 先看家底、或不确定有哪些类别 | 6 类计数、每类 category 分布、字体来源、中文字体数 |
| `anim_type_search` | 要标题样式 / 装饰 / 背景纹理 | 命中列表 + 同义词展开 + 可照抄的 `anim_type_show(id=…)` |
| `anim_type_show` | 定下一条要看完整实现 | HTML + CSS + 参数 + 坑 + 同族 3 条 |
| `anim_type_export` | 一次比多条效果 | 单文件 HTML 画廊（每条 iframe `srcdoc` 隔离样式） |
| `anim_font_search` | 挑字体（含中文场景） | family / 来源 / 分类 / 字重 / 许可 / 搭配建议 |
| `anim_font_css` | 要字体引入代码 | `@import` / `<link>` / 字体兜底栈三段；`dir` 时写 CSS 文件 |
| `anim_brand_kit` | 整套视觉定调（配色 + 字体 + 圆角 + 间距 + 字阶） | 5 套色板、5 组字体配对、CSS 变量；`dir` 时写 `tokens.css` |
| `anim_background` | 首屏大背景、卡片底纹、PPT 背景 | 14 种预设按色板换色，给 CSS + `::before` 用法 + 预览页 |
| `anim_icon_group` | 导航、按钮、空状态、功能列表要图标 | 6 组图标集合（ui / solid / game / brand / emoji / arrows），走 Iconify 取 SVG，可批量落盘 |
| `anim_type_audit` | 页面/海报/PPT 排版交付前 | 15 条硬规则，按必修 / 该修 / 可选分级并给修法 |

## 三条常用流程

### ① 做标题 / 海报文字

```
anim_type_search(query="水墨 竖排", kind="effect")   → 挑一条
anim_type_show(id="vertical")                        → 抄 HTML + CSS
anim_type_export(ids=["vertical","neon-glow"], dir="out/gallery")  → 浏览器里对比
```

中文口语不用担心：`水墨` 会展开成「国风 / 书法 / 毛笔 / 竖排」，`霓虹` 展开成「发光 / neon」，`高级` 展开成「柔光 / 极简 / 编辑 / 衬线」。同义词表在 `lib/type.js` 的 `TYPE_SYNONYMS`，加词只改那一处。

### ② 定整套视觉（配色 + 字体 + 圆角）

```
anim_brand_kit(theme="咖啡店官网", dir="out")   → 色板 warm + 中文优先字体 + tokens.css
anim_font_css(family="Noto Sans SC", weights=["400","700"])
anim_background(preset="paper", colors=["#faf6ee"])
```

`theme` 里的关键词会选色板：咖啡/茶/烘焙/婚礼 → warm；森林/环保/健康 → forest；儿童/派对/潮玩 → candy；极简/杂志/画廊 → mono；科技/AI/SaaS/数据/游戏 → ink。深色可用 `dark=true` 或主题里带「暗 / 夜 / 科技」。

### ③ 图标 + 排版体检

```
anim_icon_group(group="ui", query="arrow", download=true, dir="assets/icons")
anim_type_audit(scope="page")   → 15 条，先修「必修」那 1 条
```

## 字体许可与自托管

- Google 字体（`source=google`）：css2 接口按 `unicode-range` 拆子集，中文只下载用到的字块；商用按各字体许可（多为 OFL 1.1）。
- Fontshare 字体：免费商用但受 ITF FFL 条款约束，交付前看一眼具体字体页面。
- 自托管（`source=fontsource`）：给的是 `@fontsource/<id>` 的引入方式；项目里 `npm i @fontsource/<id>` 最稳（jsDelivr 在部分网络会被重置）。
- 系统字体（`source=system`）：只保证用户机器上装了才有；交付物要把字体文件一起给。
- 字体种子里的 `license` 字段是登记值，**用到交付物前仍要看官方页面**。

## 排版体检的 15 条

字阶 ≤5 档、正文行高 1.5–1.7、行长 45–75 字符、负字距只给大标题、字重 ≤3 种、中英混排留白、数字等宽、对比度 ≥4.5:1、最小字号 12px（移动 14px）、标点全半角统一、避头尾、全大写字距、长文别居中、链接不只靠颜色、字体回退链完整。

每条带 `check`（怎么查）与 `fix`（怎么修），`severity` 3 = 必修、2 = 该修、1 = 可选。

## 配置与离线

| 配置键 | 默认 | 说明 |
| --- | --- | --- |
| `typePath` | 包内 `assets/type` | 配方数据目录 |
| `typeExportDir` | `<cwd>/anim-type` | `anim_type_export` / `anim_background` / `anim_font_css` 的缺省落盘目录 |

- 180 条配方 + 71 条字体种子全在包里，**不需要联网**。
- 只有 `anim_icon_group` 查图标要联网（Iconify API）；`anim_font_search` 读本地种子，不联网。
- `anim_font_css` 只拼 URL，不替你下载字体文件。

## 几个已知的坑

1. **同 id 跨类**：`paper` / `blueprint` / `spotlight` 在装饰件和背景里各有一条。裸 id 指向装饰件那条，要背景请写 `background:paper`（`anim_type_show` 支持 `kind:id`）。
2. **`generateBackground` 只吃条目对象**：`anim_background(preset="…")` 会先按 id/name 找条目再换色；直接传字符串不行。
3. **字体没有 `id` 字段**：`fonts.json` 用 `family`，加载时归一成 `family` 的小写连字符形式（`Noto Sans SC` → `noto-sans-sc`）。
4. **画廊用 iframe `srcdoc` 隔离**：一条配方的 CSS 不会污染另一条；但也意味着画廊里不能跨条共享变量。
5. **`anim_icon_group` 不给 `query` 时只列六组**，不会空手去撞 API 的 400。

## 相关文件

- `lib/type.js`：数据加载、检索、渲染、品牌套件、背景生成、字体 CSS、图标、排版规则、画廊导出。
- `lib/type-tools.js`：10 个工具的注册与输出格式。
- `lib/brief.js`：前端设计参考包的第 ⑥ 节（字体与文字样式）从这里取数据。
- `lib/client.js`：工具视图（中文名 + 图标）。
