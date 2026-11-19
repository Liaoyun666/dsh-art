# 审查报告 · dsh-art（dsh-anim-pack）

审查日期：2026-11-01（0.4.0 元素提取更新：2026-11-02；0.5.0 镜头卡更新：2026-11-03；0.6.0 设计路由更新：2026-11-03；0.7.0 设计工艺库更新：2026-11-03）　　审查范围：整个仓库　　方式：读源码 + 真跑命令 + 实际渲图看结果

## 结论

| 维度 | 评分 | 依据 |
|---|---|---|
| 功能完整性 | A− | 31 个工具都在跑，六个数据源都有真实内容（341 / 193 / 244 / 本机提取 / 124 张镜头卡 / 8+24+15 条设计工艺）＋一个设计路由 |
| 代码质量 | B+ | 模块边界清楚、零运行时依赖、错误信息是人话；短板是 `index.js` 1,588 行、`vision.js` 1,608 行、无类型约束 |
| 测试 | B | 237 项自检含真渲染、真导出与「合成图 → 解码 → 分割 → 裁剪 → 报告」整链路，但没有单测框架、没有 mock 层 |
| 可维护性 | B+ | 索引全脚本生成、可重建；缺 lint / format / CI 之外的守护 |
| 文档 | A− | README / design.md / shots.md / SKILL.md / attribution 齐全，命令都能照抄 |
| 仓库体积 | C+ | 约 104 MB，其中 59.9 MB 是三个示例 MP4 |
| 合规 | B+ | 三种许可分得清、字体例外写清楚；素材条款是「禁止付费包装」而非标准开源许可 |

**总体 B+：可以放心自用、也够格公开给人用；不适合当「企业级依赖」，因为它是单人维护、无类型检查、体积大。**

## 1. 它到底是什么

一个 DSH 宿主侧插件（**没有客户端代码**），启动时注册 31 个 `anim_*` 工具，背后接六个数据源：
30 个查数据的工具在前，1 个入口 `anim_design_brief` 把它们按「风格 / 镜头 / 特效 / 工艺 / 配色」
重新排成一次调用，解决「工具太多、模型想不起来用」的问题。

| 数据源 | 规模 | 实现 |
|---|---|---|
| 本地素材库 | 341 条提示词 / 193 张静帧 / 10 个系列 | `lib/catalog.js` + `assets/catalog.json` |
| 参考图库（可选） | 8,496 张图 / 17 来源 / 18 分类 | `lib/refs.js`，只读 JSON API 客户端 |
| pixelfx 特效 | 244 条 / 21 分类 / 244 张预览 | `lib/fx.js` + `assets/fx/catalog.json` |
| 元素提取（本机） | 一张图 → 元素块 / 调色板 / 构图 / 提示词 | `lib/image.js` + `vision.js` + `prompt.js` + `extract.js` |
| 镜头配方卡 | 124 张 / 10 分类 / 54 张海报（上游 150 个镜头风格） | `lib/shots.js` + `assets/shots/index.json` |
| 设计工艺库 | 8 锚点 / 24 模式 / 15 准则 + 规则集（配色 5 / 字体 5 / 动效 5） | `lib/design.js` + `assets/design/*.json` |
| 设计路由 | 1 次调用 → 风格 + 镜头 + 锚点 + 特效 + 配色/版式/动效预算 | `lib/brief.js`，跨上面五组做检索与排版 |

设计上有一处值得表扬：**索引与源码分离**。插件从不 `import` 任何特效模块，只读 JSON、源码文本和预渲染的 PNG。
所以 244 条特效哪怕有语法错误，也不会把插件带崩；代价是索引可能过期（已用 `fxSourcePath()` + 自检兜住）。

## 2. 代码审查

### 2.1 结构

| 文件 | 行数 | 职责 |
|---|---|---|
| `lib/index.js` | 1,588 | 插件入口：31 个工具注册、配置规范化、卡片渲染 |
| `lib/brief.js` | 493 | 设计路由：场景识别 / 关键词加权 / 配色与动效预算 / 参考包排版 |
| `lib/design.js` | 361 | 设计工艺库：锚点 / 模式 / 准则加载、打分、配色原型、审查清单 |
| `lib/shots.js` | 419 | 镜头卡库：加载索引 / frontmatter 解析 / 检索（含正文）/ 导出 |
| `lib/catalog.js` | 164 | 本地素材库：加载 / 检索 / 抽读 / 导出 |
| `lib/refs.js` | 289 | 参考图库 HTTP 客户端：搜索 / 详情 / 下载 |
| `lib/fx.js` | 403 | 特效库：加载 / 检索 / 源码 / 导出小项目 |
| `lib/image.js` | 716 | 图片解码 / 编码：PNG（含 tRNS、Adam7）、GIF 首帧、BMP、TGA；JPEG 走 vendored jpeg-js |
| `lib/vision.js` | 1,579 | 分割与测量：像素画倍率、调色板、背景、元素分组、构图、地平线 |
| `lib/prompt.js` | 229 | 把测量结果写成生图提示词 / 特效提示词 / 检索建议 |
| `lib/extract.js` | 375 | 裁剪、接触表、色板图、`report.md`、`brief.json` |
| `lib/vendor/jpeg-decoder.js` | 1,167 | jpeg-js 0.4.4 的 `lib/decoder.js` 原文（BSD-3 / Apache-2.0） |
| `tools/install.mjs` | 278 | 装 / 卸 / 自检（junction + 托管补丁块 + 伴随技能） |
| `tools/verify.mjs` | 918 | 自检用例 |
| `tools/extract.mjs` | 81 | 命令行版提取器（`node tools/extract.mjs <图片>`） |
| `tools/build-fx.mjs` | 221 | 从 pixelfx 镜像重建索引与预览 |
| `tools/build-design.mjs` | 107 | 校验设计工艺库并重建 `assets/design/catalog.json`（`--check`） |

### 2.2 做得对的八件事

1. **零运行时依赖**。`package.json` 里只有 `peerDependencies: {cordis: "*"}`，没有 `node_modules` 也能跑。
2. **纯逻辑与宿主解耦**。三个 `lib/*.js` 都不 import cordis / DSH，所以 `tools/verify.mjs` 能用裸 node 直接测。
3. **不确定的东西给人话**。`fxErrorText()` 认出 `cannot read effect catalog` 后会直接给三条修复指令，
   而不是把栈甩给用户。
4. **导出防呆**。`exportEntry` / `exportFx` 会拒绝往库内部写
   （`refusing to export inside the library` / `refusing to export into the pixelfx mirror`），避免把素材库自己污染掉。
5. **下载安全**。40 MB 上限、`.part` 临时文件 + rename、`AbortController` 超时、缓存命中直接返回
   （`lib/refs.js`）。
6. **不写死私有设施**。参考图库地址按「配置 → 环境变量 → 占位」取；仓库里搜不到任何内网 IP。
7. **参数与输出规范化**。`clampLimit` 统一夹 limit，`fold()` 统一大小写，`resolveFx` 返回
   `exact / loose / ambiguous / missing` 四态，模糊命中会列候选而不是猜。
8. **索引可重建**。`assets/catalog.json` 与 `assets/fx/catalog.json` 都是脚本生成的，`git diff` 为空即证明没有手改。
9. **解码器自己写，第三方只留必要的一块**。PNG（含 tRNS、16bit、Adam7）、GIF 首帧（LZW + 子块）、BMP、TGA
   都是 `lib/image.js` 里手写的，只有 JPEG 借了 jpeg-js，且**原文照搬 + 两份许可原文一起进仓**，不用 `npm install`。
10. **像素画先认倍率再分析**。4×/8× 放大的图会先回到真实分辨率，色板与 bbox 都按真实像素算，
    裁剪块再按整数倍放大——不会把一块像素插值糊成一团。
11. **不假装它是识别**。`role` 只是启发式标签，报告与文档都写明「角色可能被拆开或与背景合并」，
    工具输出里没有「识别到一只猫」这类它保证不了的结论。

### 2.3 问题与风险（按严重度）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | `lib/index.js` 1,588 行，31 个工具与卡片渲染挤在一个文件；`lib/vision.js` 1,608 行 | 改一个工具要滚上千行，冲突率高 | 拆成 `lib/tools/*.js`；vision 按「检测 / 分割 / 分组 / 构图」再切 |
| 2 | 无 lint、无 format、无类型检查（连 `tsc --checkJs` 都没配） | 拼错字段名只能靠跑起来发现 | 加 eslint + `tsc --allowJs --checkJs`（JSDoc 已经写了不少） |
| 3 | `defineTool` 是自己写的 JSON Schema shim | 参数类型写错不会在注册时报错 | 换成手写 JSON Schema 常量，verify 里加 schema 快照 |
| 4 | 仓库 104 MB（示例 MP4 59.9 MB） | clone 慢，GitHub 单文件 >50 MB 会警告 | 示例视频挪到 Release，仓库降到约 44 MB |
| 5 | 预览 PNG 247 张 24.2 MB | 同上 | 量化到 128 色或转 webp，预计 6–8 MB |
| 6 | 特效源码依赖外部镜像（`pixelfx/`） | 没有镜像时导出只剩报错 | 已在 README/第 6 节写明；也可考虑 submodule |
| 7 | 错误判定靠 `/regex/.test(error.message)` | 上游改文案就失配 | 给错误加 `code` 字段 |
| 8 | 魔法数字散落（12000 / 8000 / 4096…） | 调参时容易顾此失彼 | 集中到 `lib/constants.js` |
| 9 | 元素提取是**分割不是识别** | 角色可能被拆成头/身/腿，或与背景并成一块；标签只是启发式 | 文档已写明；要更准得接检测模型，会破坏「零依赖、不联网」 |
| 10 | `lib/vendor/jpeg-decoder.js` 是第三方原文 1,167 行 | 上游有 CVE 时得自己跟；也不能 `npm audit` | 加 `vendor/README` 记版本与来源，升级时整文件替换 + 跑 verify |

### 2.4 兼容性

- 实测环境：Windows 11 + Node 24.21.0。代码里 `path.join` / `path.sep` 用得规整，
  但 `inside()` 的路径包含判断没有大小写归一——Windows 上 `C:\X` 与 `c:\x` 会被当成两个目录。
  影响仅在「导出到库内」的防呆检查，风险低。
- Linux/macOS 由新加的 GitHub Actions 兜底（`.github/workflows/verify.yml`，Node 22）。
- 浏览器端：插件是宿主侧代码，无 `window` 依赖，不需要 web 构建。

## 3. 测试审查

### 3.1 真跑了什么

| 命令 | 结果 |
|---|---|
| `node tools/verify.mjs` | **PASS — 237 项**（约 3 s，含真渲图、真提取、124 张镜头卡、设计路由与设计工艺库） |
| `DSH_REF_BASE=<真实库> node tools/verify.mjs --refs` | **PASS — 249 项**（237 + 12 项联网：真搜图、真下载两张） |
| 无镜像时 `node tools/verify.mjs` | **PASS — 231 项**（自动降级，改测失败路径） |
| 七张真实图跑 `anim_extract` | 全部成功，0.03–1.1 s 一张（scene / framed-artwork / texture / sprite-sheet 四类都命中） |
| `node tools/install.mjs` | 建 junction + 托管块 + 伴随技能成功；模块自检打印 341/193/10、244/21/73/244、124 张镜头卡 / 10 分类 / 54 海报、8 锚点 / 24 模式 / 15 准则 |
| `node tools/build-fx.mjs` | 244 条 → 索引 279 KB，21 分类，244 张预览，无报错 |
| `node tools/build-design.mjs`（含 `--check`） | 8 锚点 / 24 模式 / 15 准则 / 5 套配色 / 5 组字体配对 / 15 条反 AI 味，写出 `assets/design/catalog.json` |
| 导出小项目后 `node tools/render.mjs ice/frost-nova --zoom 2` | 103 帧 → `contact.png` 165,096 字节，不需要 `npm install` |
| `node tools/render.mjs ice/frost-nova --sheet` | 精灵表 PNG + JSON，JSON 里带 `meta.pixelfx.act` 时间轴 |

`--refs` 那 12 项要真实素材库才有的内容（水墨 / 绘本这类），本地只有 4 张演示数据时可跑通 6 项，
其余 6 项因为库里没有对应素材而失败 —— 是数据问题，不是代码回归。发布档的 249 项是在真实库上量的。

### 3.2 覆盖到的

- 31 个工具**是否都注册**，以及**每个都能真的执行**（假 `ctx` 跑 `apply()`）。
- 设计路由：认得出落地页 / 看板 / 游戏 UI（含中文 surface 名），输出六节齐全、给出可照抄的 `anim_show` / `anim_shot_show`，三套索引全空时给 build 命令而不是崩。
- 设计工艺库：四份 JSON 字段齐全、`catalog.json` 计数与源文件一致、锚点 / 准则按 id 与中文名都能解析、模式检索每个词都必须命中、三个工具（锚点 / 模式 / 审查）输出含应有的小标题、`focus` 生效、四份全缺时报 "cannot read design library" 并指出 build 命令。
- 伴随技能：装了就必须提到 `anim_design_brief`；没装则跳过（不假失败）。
- 计数一致性：341 / 193 / 10、244 / 21 / 244 与磁盘文件逐个对得上。
- 索引里每条 id 都能在镜像里找到源文件。
- 检索：精确 id 优先、分类 / 循环 / 角色过滤、未知过滤条件返回空而不是乱给。
- 导出：真的在临时目录生成 23 个文件，并且**真的渲出一张图**。
- 防呆：往库内导出必须被拒。
- 无镜像：导出要给人话，不能崩也不能假装成功。
- 元素提取：合成图（96×54 天空 / 地面 / 主体 / 文字条）走完 `encodePng → decodeImage`（逐字节无损）→ 分割 → 角色 bbox → 落盘 → 报告断言；4 倍放大的像素画要认出倍率并回到原尺寸分析；无缝贴图不裁元素块；`anim_extract` 卡片与「找不到这张图」的人话；`anim_extract_guide` 读得到文档。

### 3.3 没覆盖的（老实说）

- 没有单元测试框架（`node:test` 也没用），失败定位靠 `check()` 的 label。
- 网络层只测了失败路径，没有测「网慢 / 返回半截 JSON / 缓存目录不可写」。
- 没测并发（同时两次 `anim_fx_preview`）与超大 `ids` 数组。
- 没有视觉回归：渲出来的图画得对不对，靠人看，不靠断言。
- 提取的分割质量没有量化指标：只断言「主体被分出来了」，不保证每张图都切得干净（油画类照片会偏粗）。
- WebP / HEIC / AVIF 没做解码，只测了「明确报错让人另存 PNG」。

## 4. 安全与隐私

发布前做过的脱敏（本仓库里已经不存在这些）：

| 原来 | 现在 |
|---|---|
| 代码里写死的内网 IP（`DEFAULT_REF_BASE` 等处） | `config.refBase → DSH_REF_BASE → http://127.0.0.1:8080` 占位 |
| `assets/fx/catalog.json` 里 `repo` 是本机绝对路径 `E:\\…\\pixelfx` | 相对路径 `../../pixelfx`，并支持 `fxPath` 覆盖 |
| 文档里的 `C:\\Users\\<用户名>` / `E:\\…` 具体路径 | 统一写成 `<cwd>` / `pixelfx/` |
| 托管补丁块注释里的私有地址 | 注释说明取值顺序，不写地址 |

其余结论：

- 全仓扫过 token / `ghp_` / `sk-` / AKIA / 邮箱 / 手机号 —— **零命中**。
- 出现的 URL 都是公开上游（patch-gg/pixelfx、spritefusion、hollow-crown、开源素材许可）。
- 下载路径做了 40 MB 上限与 `.part` 原子改名，不会把半个文件留在缓存里。
- 没有执行外部输入的地方（不 `eval`、不拼接 shell 命令）。

## 5. 性能

- 自检约 3 s（含 34 项提取检查、设计路由检查与 23 项工艺库检查，其中有现场造图与真渲染）；插件启动只读几个 JSON（279 KB + assets/catalog.json + 124 张卡索引 + 约 45 KB 设计工艺库），不起服务。
- 元素提取实测（本机 CPU，单线程）：800×450 合成场景 0.40 s、480×269 精灵表 0.20 s、554×800 装裱画 1.03 s、400×560 油画 1.12 s、480×480 贴图 0.63 s、220×300 透明精灵 0.03 s。
  分析统一缩到长边 ≤1024，像素画按真实分辨率算，所以耗时稳定在 1 s 量级。
- 工具调用是一次性读文件，没有常驻内存的大对象（`fx` 索引 244 条约 1 MB）。
- `anim_fx_preview` 一次最多 12 条，防止一次塞爆对话。
- 真正的重活（渲图）在用户机器上跑，`render.mjs` 对 244 条全部跑一遍约 1 分钟量级。

## 6. 许可与合规

| 内容 | 许可 | 风险点 |
|---|---|---|
| 插件代码 | MIT | 无 |
| `assets/library/` 提示词与静帧 | 原条款：可免费使用/转发，**禁止**包装成课程或付费 skills 出售 | 不是 OSI 许可，商用前要看 `许可与来源.md` |
| `assets/fx/` | MIT（上游 patch-gg/pixelfx） | 署名链要在 NOTICE.md 里保持完整 |
| `assets/design/` | MIT（上游 Ilm-Alan/frontend-design、MickeyAlton33/web-designer-plugin、mistyhx/frontend-design-audit） | 内容是译写与改写，不是原文件；三处上游都要在 NOTICE.md / attribution.md 里署名 |
| pixelfx 的 PatchPixel 网页字体 | © Patch，保留所有权利 | **本仓库不含该文件**，已写明 |
| `lib/vendor/` 的 jpeg-js | BSD-3-Clause（© 2014 Eugene Ware）+ 解码核心 Apache-2.0（© 2011 notmasteryet） | 两份原文随文件进仓，见 `docs/attribution.md` |

合规上还有一条容易误会的事：`O_奥斯卡98部` 系列**不是影片截帧**，是拿 98 部影片当风格参照重画的插画
（`O55_甘地传` 画的是一场带红色吉祥物角色的风格化插画）。示例 MP4 是同一份提示词在两个模型下的成片。

## 7. 0.3.0 发布时为仓库补的东西

- `README.md` 重写：三个数据源、18 个工具、三条流程、目录树、配置、自检、许可、审查结论。
- `LICENSE`（MIT，仅代码）+ `NOTICE.md`（素材条款、第三方 MIT、字体例外）。
- `.github/workflows/verify.yml`：push 跑一遍离线自检。
- `.gitignore`：忽略 `node_modules` / 导出目录 / `pixelfx/` 镜像。
- `lib/fx.js`：镜像路径解析顺序改为「配置 → 索引记录 → 插件根下 `pixelfx/`」，让单独 clone 也能用。
- `tools/verify.mjs`：镜像缺席时不再假失败，改测降级路径（117 → 111 项，全部通过）。
- **0.4.0 新增**：`anim_extract` / `anim_extract_guide`、`lib/{image,vision,prompt,extract}.js`、`tools/extract.mjs`、`docs/extract.md`，
  自检扩到 153 项（无镜像 147 项），README / SKILL.md / attribution 同步。
- **0.5.0 新增**：第五个数据源 video-shotcraft 镜头配方卡 —— `anim_shot_stats` / `anim_shot_search` / `anim_shot_show` /
  `anim_shot_preview` / `anim_shot_export` / `anim_shot_random` / `anim_shot_guide`（共 27 个工具）、`lib/shots.js`、
  `tools/build-shots.mjs`、`docs/shots.md`、`assets/shots/`（124 张卡 + 54 张海报 + 80 KB 索引），
  自检扩到 201 项（无镜像 195 项），README / SKILL.md / NOTICE（Apache-2.0 署名）同步。
- **0.6.0 新增**：设计路由 `anim_design_brief`（第 28 个工具）＋ `lib/brief.js`、`docs/design.md`、
  伴随技能 `assets/companion/frontend-art-reference/SKILL.md`（安装器复制到 `~/.agents/skills/`）；
  27 个工具的描述统一补「什么时候该用」触发词；自检扩到 214 项（无镜像 208 项）。

## 8. 改进清单（按性价比排序）

1. 拆 `lib/index.js`（1,588 行）→ `lib/tools/library.js`、`refs.js`、`fx.js`、`extract.js`、`shots.js`、`design.js`，卡片渲染抽 `render-card.js`。
2. 加 `eslint` + `tsc --allowJs --checkJs`，把 JSDoc 变成真的类型检查。
3. 示例 MP4 移 Release，仓库从 104 MB 降到约 44 MB。
4. 预览 PNG 量化/转 webp（24.2 MB → 6–8 MB）。
5. `verify.mjs` 拆成 `tests/*.test.mjs`（`node:test`），让失败能精确定位。
6. 给错误加 `code` 字段，别靠正则匹配文案。
7. `refs` 客户端加「探测失败后短期熔断」，避免每次调用都等 20 s 超时。
8. 把 `pixelfx` 做成 git submodule 或 bundle 里自带一份精简镜像（只带 `src/core` + 用到的特效）。

## 9. 验收记录（可复现）

~~~bash
cd dsh-art
node tools/install.mjs --status          # 模块自检：341 条 / 193 张 / 10 系列；244 条 / 21 分类 / 73 带角色 / 244 预览；124 张镜头卡 / 10 分类 / 54 海报；8 锚点 / 24 模式 / 15 准则
node tools/verify.mjs                    # PASS — 237 项（无镜像时 PASS — 231 项）
node tools/verify.mjs --refs             # 需 DSH_REF_BASE 指向真实库：PASS — 249 项
node tools/build-fx.mjs                  # 重建索引：244 条 → 279 KB
node tools/build-design.mjs              # 重建工艺库索引：8 / 24 / 15 / 5 / 5 / 15
node tools/extract.mjs <图> --out /tmp/x  # 命令行提取：裁块 + 色板 + 接触表 + report.md
~~~

以上命令的输出都已在本报告撰写时实际跑过，不是照抄文档。

发布后 CI 也验了一遍（`.github/workflows/verify.yml`，ubuntu-latest + node 22）：

- 第一次运行 **失败**，1 项：`anim_fx_preview 给出存在的 PNG 路径` —— 断言用的正则要求盘符 `[A-Za-z]:`，Linux 上只有 `/home/...`，所以永远匹配不上。
- 改法：不再用正则猜路径，直接拿拼好的绝对路径 `resolve(ROOT,'assets','fx','previews','fire','torch','contact.png')` 比对存在性。
- 之后两次运行均 **success**，日志里是 `PASS — 111 项检查全部通过`（0.3.0 时 CI 上没有 `pixelfx/` 镜像，走降级档）。
- 结论：CI 真的会跑、真的会拦问题；同时也暴露出「本机 117 项 / 远端 111 项」不是同一个覆盖面，镜像相关的那 6 项只在本地有。

## 10. 0.4.0：元素提取（2026-11-02）

### 10.1 新增了什么

| 文件 | 行数 | 作用 |
|---|---|---|
| `lib/image.js` | 716 | PNG / GIF / BMP / TGA 解码 + PNG 编码；JPEG 委托 `lib/vendor/jpeg-decoder.js` |
| `lib/vision.js` | 1,579 | 像素画倍率检测、背景分类（种子 + 边缘感知 BFS）、区域合并（优先队列）、元素分组与附属物挂接、构图测量、地平线 |
| `lib/prompt.js` | 229 | 生图提示词 / 特效提示词 / 检索建议（纯函数，不联网） |
| `lib/extract.js` | 375 | 裁剪（含整数倍放大）、接触表、色板图、`report.md`、`brief.json` |
| `lib/vendor/jpeg-decoder.js` | 1,167 | jpeg-js 0.4.4 `lib/decoder.js` 原文 + `export { decode }` |
| `tools/extract.mjs` | 82 | 命令行入口（`--json` 可机读） |
| `docs/extract.md` | 111 | 指南：量了什么、四类图、参数、输出树、局限 |
| `assets/extract/scene.png` | — | 预览图用的演示原图（800×450，7 KB），可以自己重跑一遍 |
| `assets/extract/preview.png` | — | README 里那张预览图（1600×1000，126 KB） |

工具层新增两条：`anim_extract`（跑一次、落盘、回一张 Markdown 卡片）、`anim_extract_guide`（读指南）。

### 10.2 怎么验的

- **解码正确性**：用 Pillow 12.3.0 生成 15 张对照图（RGBA / RGB / 灰度 / 灰度+A / 8bit 调色板 / 调色板+tRNS /
  1bit / 16bit / Adam7 隔行 PNG，BMP 8/24/32，TGA 24/32/RLE，GIF 透明首帧），逐字节比对 **worstDiff = 0**；
  `encodePng` 往返也是 0。JPEG 对 libjpeg 的 PSNR 50.40 dB（worst 9/255），720p 解码 ~60–90 ms。
- **分割正确性**：三张合成场景的真值全部命中——背景 78.5%、天空/地面 43%/36%、地平线 279（真值 279）、
  主体 bbox 与 4× 像素画回到 200×113 分析；透明底精灵把「头 + 躯干 + 双腿」并成一个角色。
- **真实素材**：7 张（场景照、装裱细密画、像素载具精灵表、树丛贴图、油画等）全部跑通，0.03–1.1 s；
  像素载具图识出 24 个小图、装裱画 18 个元素、贴图 0 裁剪。
- **自检**：153 项（无镜像 147 项），其中 34 项是这次新增的提取链路检查，见 `tools/verify.mjs` 第四节；
  其中 3 项盯的是 README 那张预览图 —— 图必须真在仓库里、必须是 1600×1000 的 PNG、源图 `scene.png` 也要在（图丢了 README 就挂一张破图）。

### 10.3 踩到并修掉的坑（都留了断言防回归）

1. `describeComposition` 读 `comp.fg` / `comp.neg`，而真实字段是 `fgShare` / `negativeSpace` —— 恒输出「前景 100%、背景 0%」。
2. `describeColor` 里 `let zh = '灰'` 的初值泄漏进彩色分支 —— 「橙」变成「灰橙」，再加前缀成「鲜灰橙」。
3. 无缝贴图仍然裁元素块 —— 改成 `kind === 'texture'` 时跳过裁剪与接触表。
4. GIF 的 LZW 数据是「长度前缀子块」，必须先拼平再解；GCE 的透明色索引在 `buf[p+4]` 而不是 `p+3`。
5. 地平线原来只比较相邻两行的背景均值，宽物体横穿画面时那几行背景不足被跳过 —— 改成「只看双方都有足够背景的行」并按行切段。
6. 远景风景图被判成精灵表：原判据「背景占比高 + 元素都小」恰好也是风景图的样子。加 `cornerSpread(img) <= 12`
   （精灵表的底是一整块纯色 → 四角同色；风景图上面是天下面是地 → 四角互差很大），verify 里用 `vista.png`（必须 scene）
   与 `sheet.png`（必须 sprite-sheet）做正反回归。精灵块的尺寸特意写成不统一的 8×11 / 9×10 / 8×12…，
   否则会被像素画检测当成 3 倍放大，缩完元素全没了。
7. `describeComposition` 修好之后又发现报告里字段名对不上（`前景 / 背景：21% / 79%` 是分组输出的），
   verify 的断言只能按真实输出写 —— 断言照着自己想象的文案写，会连着失败好几轮。

### 10.4 已知限制（写进文档，不打算靠猜补）

- 分割 ≠ 识别：角色可能拆成几块或和背景合并；油画/照片这类低对比、大色块的图分得偏粗（400×560 只出 2 个元素）。
- 透明通道按背景统计，「背景占比」指透明区域。
- 精灵表不自动切行列；贴图只给配色。
- 不解码 WebP / HEIC / AVIF。
- 单角色透明图会被判成 `scene`（`kind` 只有四类，`sprite` 只是角色标签）。

### 10.5 0.4.0 验收记录

~~~bash
node tools/verify.mjs                     # PASS — 153 项（隐藏 pixelfx/ 镜像后 PASS — 147 项）
node tools/extract.mjs <图> --out /tmp/x   # 落盘 crops/ palette.png contact.png brief.json report.md
~~~

CI：`.github/workflows/verify.yml` 在 ubuntu-latest + node 22 上跑无镜像档，检查数从 111 变为 147。

## 11. 0.4.0 的 README 预览图（2026-11-02）

- 目的：让「元素提取」一眼看懂 —— 左边一张图被框成几块，右边就是它吐出来的东西。**不是终端截图。**
- 素材：`assets/extract/scene.png`（800×450 合成场景：渐变天空 + 雪顶山脊 + 纯色地面 + 树 + 红袍角色 + 左上三条字条）
  交给 `anim_extract` 真跑一遍（349 ms，`top: 8`），拿到 `brief.json` / `report.md` / `crops/`。
- 排版：PIL 脚本把「左侧原图 + 元素框 + 编号徽章 + 地平线虚线」与「右上四项指标 / 7 色调色板 / 5 张裁剪块 / 底部 fxPrompt」
  合成成 1600×1000 的 PNG（`assets/extract/preview.png`，126 KB）。
- **图里每个数字与每句话都来自那一次真实提取的输出**（背景 80.2%、前景 20%、地平线 57%、5 个元素、7 色、
  `#40526e` / `#a84d3c` 这些 hex、fxPrompt 的 7 行），没有为了好看编一个数；README 的图注也写明「这是排版图，不是截图」。
- 这张图同时也是一份回归样本：`scene.png` 留在仓库里，谁都能重跑 `node tools/extract.mjs assets/extract/scene.png` 对上号。
- 老实说：排版用的那个 PIL 脚本是一次性的，没随仓库发（插件要求零依赖，不往里塞 python）。图本身和源图都在，
  要改字改色得重写一遍排版；要重新提取数据则是上面那条命令。

## 12. 0.6.0：前端设计路由（2026-11-03）

### 12.1 为什么加

0.5.0 之后是 27 个工具、五个数据源。**工具多不等于会被用**：原来每条 description 只说明
「能查什么」，模型在「帮我做个落地页」这类任务里不会主动去翻工具列表，靠用户点名才动。
这次解决的就是触发率问题，同时把「一次找齐参考」的成本从四五次调用降到一次。

### 12.2 新增了什么

| 文件 | 行数 | 作用 |
|---|---|---|
| `lib/brief.js` | 442 | 场景识别（8 种 surface，认 id / 中文名 / 关键词）、关键词加权（英文整词 1.5、中文 2–3 字 n-gram 1–1.6、感觉词扩展 2）、跨三套索引检索、6 套配色预设、4 条动效硬指标、参考包排版 |
| `lib/index.js` | 1,433 | 新增第 28 个工具 `anim_design_brief`；27 个既有工具 description 统一补触发词 |
| `assets/companion/frontend-art-reference/SKILL.md` | 40 | 伴随技能：description 带前端/UI/海报触发场景，正文教「先 brief 再深读 2–3 次」 |
| `tools/install.mjs` | 248 | 安装时写伴随技能、`--status` 报告、`--uninstall` 只删带托管标记的那份 |
| `docs/design.md` | 164 | 指南：何时调、参数、输出结构、五个数据源分工、配色与动效预算、选型排查、常见坑 |

工具行为：输入 `task`（必填）+ `surface` / `mood` / `palette` / `motion` / `limit`，
输出 ① 3 条风格 ② 3–6 张镜头卡 ③ 3–4 条像素特效 ④ 配色 + 版式 + 动效硬指标 ⑤ 下一步调用顺序，
每条候选都带可直接照抄的 `anim_show(id="…")` / `anim_shot_show(id="…")`。只有一条 6,000 字符上限，不落盘。

### 12.3 怎么验的

- 冒烟（真实索引）：`task="深色科技风的 AI 写作产品落地页"` → `surface=web-landing`、风格 R6/K34/L42、
  镜头 opening/magician-card-flourish、ui-entrance/neon-frame-forerun、effects/spotlight-sweep-moves、
  typography/word-relay-filmstrip，配色「冷色科技」；
  `surface="dashboard"` → data/chart-live-moves 等 4 张；`surface="游戏 UI"` → fx 命中 ui/health-bar-hit；
  `surface="illustration"`（小王子海报）→ fx critters/wisp、nature/leaf-storm、weather/aurora；
  「做个好看的页面」→ 退回 generic 也有结果；三套索引全 null → 输出三条 build 命令，不崩。
- 断言进 `tools/verify.mjs`：注册 28 个工具、brief 五节齐全、给出可照抄调用、显式 surface 优先、
  中文 surface 名、空任务也给通用包、输出 < 6,000 字符、`resolveSurface` / `tokensOf` 纯函数、
  空索引降级、伴随技能装了就必须提到 `anim_design_brief`。
- `node tools/verify.mjs` → **PASS — 214 项**。

### 12.4 踩到并修掉的坑

1. **函数名撞车**：`lib/prompt.js` 早有一个 `buildBrief`（生图提示词），verify 同时 import 两者会重名 ——
   路由侧改名 `buildDesignBrief`，导出与调用点一起改。
2. **镜头卡标题是一整句话**：原样塞进 brief 会一条撑到几百字，改成截断 46 字，正文交给 `anim_shot_show`。
3. **场景判断顺序**：开头写成「先按 task 猜、再被显式 surface 覆盖」，结果显式给了 `dashboard` 仍被
   task 里的「落地页」抢走 —— 改成 `explicit.id !== 'generic' ? explicit : resolveSurface(task)`。
4. **特效不看场景**：只看关键词时 HUD 拿不到血条类特效；每类补 `fxHints` 关键词并按场景 +0.9 加权。
5. **技能正文里嵌套反引号**：最初把 SKILL.md 正文写成 install.mjs 里的模板字符串，反引号直接语法错 ——
   改成正文随包发在 `assets/companion/`，安装器只负责复制。

### 12.5 已知限制

- 选型是关键词打分，不是语义模型：任务描述太泛时会给不准，补 `surface` / `mood` 通常立刻变好。
- brief 只读不写：要落盘卡片或特效，仍需 `anim_shot_export` / `anim_fx_export` 并给 `dir`。
- 伴随技能只是「提醒入口」，不保证每次都被模型读到；真正的兜底仍是用户点名工具。
- 触发率没有量化指标：只做了新会话手测（问「做个深色风落地页」，第一步是否调 brief），没有 A/B 数据。

## 13. 0.7.0：设计工艺库（2026-11-03）

### 13.1 为什么加

0.6.0 解决了「不知道调工具」，但没解决「调了之后照着做出来还是 AI 味」。上游三个 MIT 项目的共同点值得抄：
它们不提供素材，只提供**判断标准** —— 八条美学锚点、24 条版面模式、15 条可用性准则，以及一套反 AI 味的规则集。
这类知识不会过时，也不需要联网，正好补上 0.6.0 只有「找参考」没有「怎么定稿」的缺口。

不复用它们的形态：三个项目都是纯 Markdown skill（给 Claude Code 读的作用域文件），本插件是宿主侧工具，
所以只能**译写成结构化 JSON + 三个检索工具**，让模型按需取一小段，而不是一次读 30 KB 正文。

### 13.2 新增了什么

| 文件 | 行数 | 作用 |
|---|---|---|
| `lib/design.js` | 361 | 加载四份 JSON、锚点 / 准则解析、按 token 与 surface 打分、配色原型选择、审查清单排版 |
| `assets/design/anchors.json` | — | 8 条锚点（Swiss / Industrial / Brutalist / Aurora / Chaotic / Retro-Future / Organic / Lo-Fi），每条含底 / 字 / 强调 / 结构 / 质感 / 动效 / 签名动作 / 会破的写法 |
| `assets/design/patterns.json` | — | 24 条版式与交互模式（layout 4 / card 4 / nav 3 / section 3 / text 3 / utility 4 / advanced 1），每条带可直接抄的 CSS |
| `assets/design/heuristics.json` | — | 15 条可用性准则（Status / Real World / Control / Consistency / …）＋ 0–4 严重度标尺与代码层检查点 |
| `assets/design/rules.json` | — | 15 条反 AI 味、6 条内容纪律、6 条工艺底线、5 套配色原型、5 组字体配对、7 条排版层级、5 档动效时长、fluid type/space scale |
| `tools/build-design.mjs` | 107 | 校验四份 JSON 并重建 `catalog.json`（`--check` 只比对计数） |
| `docs/design-library.md` | 120 | 三个工具的用法、真实输出片段、数据文件表、改数据流程、常见坑 |

工具层新增三条，并把 `anim_design_brief` 从五节扩到六节：

- `anim_design_anchors`：无参数列 8 条锚点的差异；给 `query` 读一条全文（id / 中文名 / 关键词都能认）。
- `anim_design_patterns`：无参数列 7 类；给 `query` / `category` 检索模式并附 CSS 与「为什么」。
- `anim_design_audit`：15 条准则 + 反 AI 味 + 内容纪律 + 工艺底线；给 `focus` 只展开相关的那几条。
- `anim_design_brief` 新增「③ 美学锚点」（1–2 条，按任务词打分）与「⑤ 版式与配色」里的配色原型 + 首选模式，
  「⑥ 下一步」追加 `anim_design_anchors` 与 `anim_design_audit` 两条调用建议。

### 13.3 怎么验的

- `node tools/verify.mjs` → **PASS — 237 项**；隐藏 `pixelfx/` 镜像后 → **PASS — 231 项**（差 6 项镜像检查）。
- 新增 23 项断言：四份 JSON 与 `catalog.json` 计数一致、`resolveAnchor` 认得 `swiss` 与「瑞士国际主义」、
  `searchPatterns` 多词必须同时命中、四份全缺时报 `cannot read design library`、三个工具的输出含
  `## 中文名 · Name` 与 `原则：` / `代码层这样查：`、`focus` 只展开命中的准则、brief 含
  `## ③ 美学锚点` 与 `## ⑤ 版式与配色` / `- 版式：`。
- `node tools/install.mjs --status` 多打一行「工艺库：8 条锚点 / 24 条模式 / 15 条准则（5 套配色 / 5 组字体配对）」。

### 13.4 踩到并修掉的坑

1. **CSS 字段里混进了纯 JS**：`utility/scroll-lock` 原样抄下来只有 `document.body.classList…`，没有一条选择器。
   改成 CSS 优先（`html{scrollbar-gutter:stable}` / `body.is-locked{overflow:hidden}`）再附 JS 补 padding。
2. **brief 的章节号是硬编码**：插两个新节要同步改断言文案（`## ⑤ 下一步` → `## ⑥ 下一步`），
   否则 verify 会挂在「输出缺下一步」上，看上去像功能坏了。
3. **`designStats` 导入了却没用**：ESM 不报错，`node --check` 也不报，只有人看 import 列表才发现 —— 留在 index.js 里给自检用，别删。
4. **快照被 tmp/ 卡死**：`tmp/edge-prof2` 里的浏览器 profile 文件「Device or resource busy」，`tar` exit 2。
   已在 `scripts/snapshot.sh` 的 EXCLUDES 加 `--exclude='tmp'`（临时下载 / 探针 / 浏览器 profile 本来就不该进快照）。
5. **中文长词查不到**：`searchPatterns("数据看板")` 整词不中就直接空手而归（卡片里只写「看板」或不写）。
   加了两层：`termMatches` 对 3 字以上的中文词按 2 字组合再匹配一次；严格档为空时退成「命中任意词」的排序结果。
6. **配色出现两个名字**：brief 自己的 6 套预设给「冷色科技」，工艺库原型按「深色」给「暗色奢华」，同一份输出里自相矛盾。
   改成只把原型当 CSS 变量脚手架（「变量名照抄，色值换成上面那组」），不再并列两个配色结论。
7. **文档里编了个 id**：示例写成 `card/stat-tile`，24 条模式里根本没有这条（看板类专用版式本身缺）。
   改成真实存在的 `layout/full-bleed-alternate` 与 `card/glass`，并在已知限制里写明看板类版式偏少。
8. **模板字符串被外层先求值**：在 run_code 里拼一段 Node 脚本，里面的 `${DESIGN_FILES}` 被外层程序当变量算，
   抛 `ReferenceError`。嵌套时改用数组 join 或转义。

### 13.5 已知限制

- **打分仍是关键词，不是语义**：锚点靠 id / 名称 / 关键词 / 适用场景命中，任务写得抽象时可能给偏；显式给 `surface` 会好很多。
- **数据是译写**：为了放进 JSON 做过压缩与改写，长解释被砍成短语；要看原文得回三个上游仓库。
- **rules.json 没有独立工具**：它只在 brief 与 audit 里被引用（配色原型、反 AI 味、工艺底线），想整份读只能看文件。
- **版式模式偏营销页**：24 条来自获奖站点的长页 / 落地页，看板、后台、表格密度这类专用版式几乎没有；
  给 `surface=dashboard` 时只能退到通用卡片与布局。
- **不做视觉验证**：audit 给的是清单，不是「看一眼截图判断」；真要判断还得人看渲染结果。

