# 设计工艺库（第六个数据源）

前五个数据源回答「长什么样」和「怎么动」：341 条风格提示词、124 张镜头卡、244 条像素特效、
参考图库、元素提取。这一组回答另外两个问题：

- **为什么这样排**——八条美学锚点锁死底色 / 字体 / 强调色 / 结构 / 质感 / 动效；
  24 条版式模式给可直接抄的 CSS。
- **怎样算没做砸**——15 条可用性准则 + 0–4 严重度、15 条反 AI 味、内容纪律、工艺底线。

数据随包发在 `assets/design/`，不联网、不下载、没有额外配置项。

## 三个工具

| 工具 | 什么时候调 | 参数 |
| --- | --- | --- |
| `anim_design_anchors` | 定调阶段：先锁一个锚点再写代码 | `query`（可选，id 或中文名） |
| `anim_design_patterns` | 写 CSS 时找现成做法 | `query` / `category` / `limit` |
| `anim_design_audit` | 交付前逐项过一遍 | `focus`（可选，只展开一条） |

三个工具都只读，不会改你的项目文件。真正的入口是 `anim_design_brief`：它会按任务自动挑
1–2 个锚点、3 条模式、一套配色原型，并把这三个工具排进「下一步」。

### anim_design_anchors

不传 `query` 列出八条，每条一句话 + 签名动作：

```
# 八条美学锚点（8 条，整页只锁一个）

- swiss · 瑞士国际主义 — 作品集、建筑 / 文化机构、杂志式排版｜签名：把网格线本身做成视觉语言：细线分隔 + 大号数字/页码 + 左对齐的悬挂标点
- industrial · 工业终端 — 开发者工具、监控后台、数据看板｜签名：等宽排版 + 一个语义色的状态灯 + 表格化数字，像一台真的机器
...
```

传 `query` 读一条完整卡：

```
## 瑞士国际主义 · Swiss（swiss）

适合：作品集、建筑 / 文化机构、杂志式排版、编辑感落地页
检索词：瑞士、网格、极简、白色、字号、swiss、grid、helvetica、edito

- 底：纯白 #FFFFFF 或中性 #F7F7F8
- 字：Akzidenz-Grotesk / Helvetica Neue / Söhne——无衬线，显示与正文同一族
- 强调：瑞士红 #E4002B、国际橙 #FF4F00 或克莱因蓝 #002FA7，只选一个，用得克制
- 结构：可见网格线或 1px 发丝线；左对齐、非对称平衡；数字当构图元素
- 质感：无纹理。留白即结构。
- 动效：克制：150–250ms 的淡入与位移，可用划线与遮罩揭示；不要弹跳
- 签名动作：把网格线本身做成视觉语言：细线分隔 + 大号数字/页码 + 左对齐的悬挂标点

会破的写法（出现其中一项就不算这个锚点）：暖纸色、衬线标题、颗粒纹理、居中对齐的排版
```

**整页只锁一个锚点。** 两个混着用就是「什么都有点像」，最后什么都不像。

### anim_design_patterns

不给条件时列 7 个分类：`layout` 版式 / `card` 卡片 / `nav` 导航与按钮 /
`section` 章节 / `text` 文字效果 / `utility` 工具 / `advanced` 进阶。

给 `query` 时每个词都必须命中（同时搜名称、为什么、什么时候用和 CSS 正文）：

```
anim_design_patterns(query="悬停 抬升")
anim_design_patterns(category="layout", limit=3)
anim_design_patterns(query="layout/asymmetric-grid")   # 直接给 id 也行
```

每条输出「为什么 / 什么时候用 / 完整 CSS」。**抄 CSS 前把变量名换成项目自己的 token**，
别把上游的 `--space-*`、`--color-*` 一起搬进项目。

### anim_design_audit

输出 15 条准则的总表，每条一行「[id] 中文名（English）」，再给严重度标尺、反 AI 味、
内容纪律与工艺底线。传 `focus` 只展开一条（其余仍列标题）：

```
anim_design_audit()
anim_design_audit(focus="accessibility")
anim_design_audit(focus="错误预防")
```

严重度按「频率 × 影响 × 持续性」算，不看修复难度：≥3 必须改，2 分挑最便宜的改，
0–1 可以留着。**别把 15 条当成 15 个 TODO 全改一遍**——先修 3 分以上的。

## 数据文件

| 文件 | 内容 | 上游（均 MIT） |
| --- | --- | --- |
| `anchors.json` | 8 条锚点：`id/name/nameZh/keywords/bestFor/surface/typography/accent/structure/texture/motion/breaksIf[]/signature` | Ilm-Alan/frontend-design |
| `patterns.json` | 24 条模式：`id/category/categoryName/name/keywords/why/when/css` | MickeyAlton33/web-designer-plugin |
| `heuristics.json` | 15 条准则：`id/name/nameZh/principle/lookFor[]/severity[]` + 5 档 `scale` | mistyhx/frontend-design-audit |
| `rules.json` | `antiPatterns` 15 / `contentDiscipline` 6 / `craftFloor` 6 / `palettes` 5 / `typePairings` 5 / `typeRules` 7 / `fontsToAvoid` 5 / `motionTiming` 5 / `typeScale` / `spaceScale` / `signatureHint` | 前两个上游 |
| `catalog.json` | 计数与出处摘要，由脚本生成 | — |

24 条模式来自获奖站点的营销页与长页，**看板 / 后台类的专用版式偏少**（只有通用卡片与布局），
要更细的指标卡、表格密度这类，得自己按设计系统的套路补。

`rules.json` 没有单独的工具：配色原型与字体配对由 `anim_design_brief` 带出，
反 AI 味 / 内容纪律 / 工艺底线由 `anim_design_audit` 带出。

## 改数据

1. 改 `assets/design/*.json`（保持字段名不变，`lib/design.js` 按字段读）。
2. `node tools/build-design.mjs` 重建 `catalog.json` 并校验四份文件。
3. `node tools/verify.mjs`：会检查条数（8 / 24 / 15）、每条锚点的六个 token 与破法、
   每条模式的 CSS 与分类、每条准则的查法与严重度、以及三个工具的输出。
4. 只想知道索引有没有过期：`node tools/build-design.mjs --check`（不一致时 exit 1）。

## 出处

三个上游都是 MIT，本仓库收的是**中文译写后的要点**，不是原文件复制；署名与许可见
[NOTICE.md](../NOTICE.md) 第 6 节与 [docs/attribution.md](attribution.md)。
上游的 SKILL.md、长文档、示例页面没有收录。

## 常见坑

- **锚点当主题用**：一个页面只锁一个；「瑞士 + 极光」会是灾难。
- **CSS 直接粘贴**：变量名、类名都要改成项目自己的，否则样式互相覆盖。
- **审查清单全改**：先修 ≥3 分的，0–1 分留着不会有人投诉。
- **关键词检索不是语义检索**：`searchPatterns` 按词命中打分，换个说法可能搜不到；
  搜不到就先列分类再用 `category` 筛。
- **锚点只给 token 不给完整页面**：它定的是「往哪个方向走」，具体版式还要配模式与镜头卡。
