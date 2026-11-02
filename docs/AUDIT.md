# 审查报告 · dsh-art（dsh-anim-pack）

审查日期：2026-11-01（0.4.0 元素提取更新：2026-11-02）　　审查范围：整个仓库　　方式：读源码 + 真跑命令 + 实际渲图看结果

## 结论

| 维度 | 评分 | 依据 |
|---|---|---|
| 功能完整性 | A− | 20 个工具都在跑，四个数据源都有真实内容（341 / 193 / 244 / 本机提取） |
| 代码质量 | B+ | 模块边界清楚、零运行时依赖、错误信息是人话；短板是 `index.js` 1,071 行、`vision.js` 1,579 行、无类型约束 |
| 测试 | B | 148 项自检含真渲染、真导出与「合成图 → 解码 → 分割 → 裁剪 → 报告」整链路，但没有单测框架、没有 mock 层 |
| 可维护性 | B+ | 索引全脚本生成、可重建；缺 lint / format / CI 之外的守护 |
| 文档 | A− | README / fx.md / SKILL.md / attribution 齐全，命令都能照抄 |
| 仓库体积 | C+ | 约 100 MB，其中 59.9 MB 是三个示例 MP4 |
| 合规 | B+ | 三种许可分得清、字体例外写清楚；素材条款是「禁止付费包装」而非标准开源许可 |

**总体 B+：可以放心自用、也够格公开给人用；不适合当「企业级依赖」，因为它是单人维护、无类型检查、体积大。**

## 1. 它到底是什么

一个 DSH 宿主侧插件（**没有客户端代码**），启动时注册 20 个 `anim_*` 工具，背后接四个数据源：

| 数据源 | 规模 | 实现 |
|---|---|---|
| 本地素材库 | 341 条提示词 / 193 张静帧 / 10 个系列 | `lib/catalog.js` + `assets/catalog.json` |
| 参考图库（可选） | 8,496 张图 / 17 来源 / 18 分类 | `lib/refs.js`，只读 JSON API 客户端 |
| pixelfx 特效 | 244 条 / 21 分类 / 244 张预览 | `lib/fx.js` + `assets/fx/catalog.json` |
| 元素提取（本机） | 一张图 → 元素块 / 调色板 / 构图 / 提示词 | `lib/image.js` + `vision.js` + `prompt.js` + `extract.js` |

设计上有一处值得表扬：**索引与源码分离**。插件从不 `import` 任何特效模块，只读 JSON、源码文本和预渲染的 PNG。
所以 244 条特效哪怕有语法错误，也不会把插件带崩；代价是索引可能过期（已用 `fxSourcePath()` + 自检兜住）。

## 2. 代码审查

### 2.1 结构

| 文件 | 行数 | 职责 |
|---|---|---|
| `lib/index.js` | 1,071 | 插件入口：20 个工具注册、配置规范化、卡片渲染 |
| `lib/catalog.js` | 164 | 本地素材库：加载 / 检索 / 抽读 / 导出 |
| `lib/refs.js` | 289 | 参考图库 HTTP 客户端：搜索 / 详情 / 下载 |
| `lib/fx.js` | 403 | 特效库：加载 / 检索 / 源码 / 导出小项目 |
| `lib/image.js` | 716 | 图片解码 / 编码：PNG（含 tRNS、Adam7）、GIF 首帧、BMP、TGA；JPEG 走 vendored jpeg-js |
| `lib/vision.js` | 1,579 | 分割与测量：像素画倍率、调色板、背景、元素分组、构图、地平线 |
| `lib/prompt.js` | 229 | 把测量结果写成生图提示词 / 特效提示词 / 检索建议 |
| `lib/extract.js` | 375 | 裁剪、接触表、色板图、`report.md`、`brief.json` |
| `lib/vendor/jpeg-decoder.js` | 1,167 | jpeg-js 0.4.4 的 `lib/decoder.js` 原文（BSD-3 / Apache-2.0） |
| `tools/install.mjs` | 226 | 装 / 卸 / 自检（junction + 托管补丁块） |
| `tools/verify.mjs` | 621 | 自检用例 |
| `tools/extract.mjs` | 82 | 命令行版提取器（`node tools/extract.mjs <图片>`） |
| `tools/build-fx.mjs` | 222 | 从 pixelfx 镜像重建索引与预览 |

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
| 1 | `lib/index.js` 1,071 行，20 个工具与卡片渲染挤在一个文件；`lib/vision.js` 1,579 行 | 改一个工具要滚上千行，冲突率高 | 拆成 `lib/tools/*.js`；vision 按「检测 / 分割 / 分组 / 构图」再切 |
| 2 | 无 lint、无 format、无类型检查（连 `tsc --checkJs` 都没配） | 拼错字段名只能靠跑起来发现 | 加 eslint + `tsc --allowJs --checkJs`（JSDoc 已经写了不少） |
| 3 | `defineTool` 是自己写的 JSON Schema shim | 参数类型写错不会在注册时报错 | 换成手写 JSON Schema 常量，verify 里加 schema 快照 |
| 4 | 仓库 98.8 MB（示例 MP4 59.9 MB） | clone 慢，GitHub 单文件 >50 MB 会警告 | 示例视频挪到 Release，仓库降到约 39 MB |
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
| `node tools/verify.mjs` | **PASS — 148 项**（约 3 s，含真渲图与真提取） |
| `DSH_REF_BASE=<真实库> node tools/verify.mjs --refs` | **PASS — 160 项**（真搜图、真下载两张） |
| 无镜像时 `node tools/verify.mjs` | **PASS — 142 项**（自动降级，改测失败路径） |
| 七张真实图跑 `anim_extract` | 全部成功，0.03–1.1 s 一张（scene / framed-artwork / texture / sprite-sheet 四类都命中） |
| `node tools/install.mjs` | 建 junction + 托管块成功；模块自检打印 341/193/10 与 244/21/73/244 |
| `node tools/build-fx.mjs` | 244 条 → 索引 279 KB，21 分类，244 张预览，无报错 |
| 导出小项目后 `node tools/render.mjs ice/frost-nova --zoom 2` | 103 帧 → `contact.png` 165,096 字节，不需要 `npm install` |
| `node tools/render.mjs ice/frost-nova --sheet` | 精灵表 PNG + JSON，JSON 里带 `meta.pixelfx.act` 时间轴 |

### 3.2 覆盖到的

- 20 个工具**是否都注册**，以及**每个都能真的执行**（假 `ctx` 跑 `apply()`）。
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

- 自检约 3 s（新增 31 项提取检查，含现场造图与真渲染）；插件启动只读两个 JSON（279 KB + assets/catalog.json），不起服务。
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
  自检扩到 148 项（无镜像 142 项），README / SKILL.md / attribution 同步。

## 8. 改进清单（按性价比排序）

1. 拆 `lib/index.js`（1,071 行）→ `lib/tools/library.js`、`refs.js`、`fx.js`、`extract.js`，卡片渲染抽 `render-card.js`。
2. 加 `eslint` + `tsc --allowJs --checkJs`，把 JSDoc 变成真的类型检查。
3. 示例 MP4 移 Release，仓库从 98.8 MB 降到约 39 MB。
4. 预览 PNG 量化/转 webp（24.2 MB → 6–8 MB）。
5. `verify.mjs` 拆成 `tests/*.test.mjs`（`node:test`），让失败能精确定位。
6. 给错误加 `code` 字段，别靠正则匹配文案。
7. `refs` 客户端加「探测失败后短期熔断」，避免每次调用都等 20 s 超时。
8. 把 `pixelfx` 做成 git submodule 或 bundle 里自带一份精简镜像（只带 `src/core` + 用到的特效）。

## 9. 验收记录（可复现）

~~~bash
cd dsh-art
node tools/install.mjs --status          # 模块自检：341 条 / 193 张 / 10 系列；244 条 / 21 分类 / 73 带角色 / 244 预览
node tools/verify.mjs                    # PASS — 148 项（无镜像时 PASS — 142 项）
node tools/verify.mjs --refs             # 需 DSH_REF_BASE 指向真实库：PASS — 160 项
node tools/build-fx.mjs                  # 重建索引：244 条 → 279 KB
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

工具层新增两条：`anim_extract`（跑一次、落盘、回一张 Markdown 卡片）、`anim_extract_guide`（读指南）。

### 10.2 怎么验的

- **解码正确性**：用 Pillow 12.3.0 生成 15 张对照图（RGBA / RGB / 灰度 / 灰度+A / 8bit 调色板 / 调色板+tRNS /
  1bit / 16bit / Adam7 隔行 PNG，BMP 8/24/32，TGA 24/32/RLE，GIF 透明首帧），逐字节比对 **worstDiff = 0**；
  `encodePng` 往返也是 0。JPEG 对 libjpeg 的 PSNR 50.40 dB（worst 9/255），720p 解码 ~60–90 ms。
- **分割正确性**：三张合成场景的真值全部命中——背景 78.5%、天空/地面 43%/36%、地平线 279（真值 279）、
  主体 bbox 与 4× 像素画回到 200×113 分析；透明底精灵把「头 + 躯干 + 双腿」并成一个角色。
- **真实素材**：7 张（场景照、装裱细密画、像素载具精灵表、树丛贴图、油画等）全部跑通，0.03–1.1 s；
  像素载具图识出 24 个小图、装裱画 18 个元素、贴图 0 裁剪。
- **自检**：148 项（无镜像 142 项），其中 31 项是这次新增的提取链路检查，见 `tools/verify.mjs` 第四节。

### 10.3 踩到并修掉的坑（都留了断言防回归）

1. `describeComposition` 读 `comp.fg` / `comp.neg`，而真实字段是 `fgShare` / `negativeSpace` —— 恒输出「前景 100%、背景 0%」。
2. `describeColor` 里 `let zh = '灰'` 的初值泄漏进彩色分支 —— 「橙」变成「灰橙」，再加前缀成「鲜灰橙」。
3. 无缝贴图仍然裁元素块 —— 改成 `kind === 'texture'` 时跳过裁剪与接触表。
4. GIF 的 LZW 数据是「长度前缀子块」，必须先拼平再解；GCE 的透明色索引在 `buf[p+4]` 而不是 `p+3`。
5. 地平线原来只比较相邻两行的背景均值，宽物体横穿画面时那几行背景不足被跳过 —— 改成「只看双方都有足够背景的行」并按行切段。

### 10.4 已知限制（写进文档，不打算靠猜补）

- 分割 ≠ 识别：角色可能拆成几块或和背景合并；油画/照片这类低对比、大色块的图分得偏粗（400×560 只出 2 个元素）。
- 透明通道按背景统计，「背景占比」指透明区域。
- 精灵表不自动切行列；贴图只给配色。
- 不解码 WebP / HEIC / AVIF。
- 单角色透明图会被判成 `scene`（`kind` 只有四类，`sprite` 只是角色标签）。

### 10.5 0.4.0 验收记录

~~~bash
node tools/verify.mjs                     # PASS — 148 项（隐藏 pixelfx/ 镜像后 PASS — 142 项）
node tools/extract.mjs <图> --out /tmp/x   # 落盘 crops/ palette.png contact.png brief.json report.md
~~~

CI：`.github/workflows/verify.yml` 在 ubuntu-latest + node 22 上跑无镜像档，检查数从 111 变为 142。
