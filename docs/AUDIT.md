# 审查报告 · dsh-art（dsh-anim-pack）

审查日期：2026-11-01　　审查范围：整个仓库 820 个文件 / 98.78 MB　　方式：读源码 + 真跑命令 + 实际渲图看结果

## 结论

| 维度 | 评分 | 依据 |
|---|---|---|
| 功能完整性 | A− | 18 个工具都在跑，三个数据源都有真实内容（341 / 193 / 244） |
| 代码质量 | B+ | 模块边界清楚、零依赖、错误信息是人话；短板是 `index.js` 900 行、无类型约束 |
| 测试 | B | 117 项自检含真渲染与真导出，但没有单测框架、没有 mock 层 |
| 可维护性 | B+ | 索引全脚本生成、可重建；缺 lint / format / CI 之外的守护 |
| 文档 | A− | README / fx.md / SKILL.md / attribution 齐全，命令都能照抄 |
| 仓库体积 | C+ | 98.8 MB，其中 59.9 MB 是三个示例 MP4 |
| 合规 | B+ | 三种许可分得清、字体例外写清楚；素材条款是「禁止付费包装」而非标准开源许可 |

**总体 B+：可以放心自用、也够格公开给人用；不适合当「企业级依赖」，因为它是单人维护、无类型检查、体积大。**

## 1. 它到底是什么

一个 DSH 宿主侧插件（**没有客户端代码**），启动时注册 18 个 `anim_*` 工具，背后接三个数据源：

| 数据源 | 规模 | 实现 |
|---|---|---|
| 本地素材库 | 341 条提示词 / 193 张静帧 / 10 个系列 | `lib/catalog.js` + `assets/catalog.json` |
| 参考图库（可选） | 8,496 张图 / 17 来源 / 18 分类 | `lib/refs.js`，只读 JSON API 客户端 |
| pixelfx 特效 | 244 条 / 21 分类 / 244 张预览 | `lib/fx.js` + `assets/fx/catalog.json` |

设计上有一处值得表扬：**索引与源码分离**。插件从不 `import` 任何特效模块，只读 JSON、源码文本和预渲染的 PNG。
所以 244 条特效哪怕有语法错误，也不会把插件带崩；代价是索引可能过期（已用 `fxSourcePath()` + 自检兜住）。

## 2. 代码审查

### 2.1 结构

| 文件 | 行数 | 职责 |
|---|---|---|
| `lib/index.js` | 900 | 插件入口：18 个工具注册、配置规范化、卡片渲染 |
| `lib/catalog.js` | 164 | 本地素材库：加载 / 检索 / 抽读 / 导出 |
| `lib/refs.js` | 289 | 参考图库 HTTP 客户端：搜索 / 详情 / 下载 |
| `lib/fx.js` | 403 | 特效库：加载 / 检索 / 源码 / 导出小项目 |
| `tools/install.mjs` | 226 | 装 / 卸 / 自检（junction + 托管补丁块） |
| `tools/verify.mjs` | 467 | 自检用例 |
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

### 2.3 问题与风险（按严重度）

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | `lib/index.js` 900 行，18 个工具与卡片渲染挤在一个文件 | 改一个工具要滚 900 行，冲突率高 | 拆成 `lib/tools/*.js`，每数据源一个文件 |
| 2 | 无 lint、无 format、无类型检查（连 `tsc --checkJs` 都没配） | 拼错字段名只能靠跑起来发现 | 加 eslint + `tsc --allowJs --checkJs`（JSDoc 已经写了不少） |
| 3 | `defineTool` 是自己写的 JSON Schema shim | 参数类型写错不会在注册时报错 | 换成手写 JSON Schema 常量，verify 里加 schema 快照 |
| 4 | 仓库 98.8 MB（示例 MP4 59.9 MB） | clone 慢，GitHub 单文件 >50 MB 会警告 | 示例视频挪到 Release，仓库降到约 39 MB |
| 5 | 预览 PNG 247 张 24.2 MB | 同上 | 量化到 128 色或转 webp，预计 6–8 MB |
| 6 | 特效源码依赖外部镜像（`pixelfx/`） | 没有镜像时导出只剩报错 | 已在 README/第 6 节写明；也可考虑 submodule |
| 7 | 错误判定靠 `/regex/.test(error.message)` | 上游改文案就失配 | 给错误加 `code` 字段 |
| 8 | 魔法数字散落（12000 / 8000 / 4096…） | 调参时容易顾此失彼 | 集中到 `lib/constants.js` |

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
| `node tools/verify.mjs` | **PASS — 117 项**（0.6 s） |
| `DSH_REF_BASE=<真实库> node tools/verify.mjs --refs` | **PASS — 129 项**（真搜图、真下载两张） |
| 无镜像时 `node tools/verify.mjs` | **PASS — 111 项**（自动降级，改测失败路径） |
| `node tools/install.mjs` | 建 junction + 托管块成功；模块自检打印 341/193/10 与 244/21/73/244 |
| `node tools/build-fx.mjs` | 244 条 → 索引 279 KB，21 分类，244 张预览，无报错 |
| 导出小项目后 `node tools/render.mjs ice/frost-nova --zoom 2` | 103 帧 → `contact.png` 165,096 字节，不需要 `npm install` |
| `node tools/render.mjs ice/frost-nova --sheet` | 精灵表 PNG + JSON，JSON 里带 `meta.pixelfx.act` 时间轴 |

### 3.2 覆盖到的

- 18 个工具**是否都注册**，以及**每个都能真的执行**（假 `ctx` 跑 `apply()`）。
- 计数一致性：341 / 193 / 10、244 / 21 / 244 与磁盘文件逐个对得上。
- 索引里每条 id 都能在镜像里找到源文件。
- 检索：精确 id 优先、分类 / 循环 / 角色过滤、未知过滤条件返回空而不是乱给。
- 导出：真的在临时目录生成 23 个文件，并且**真的渲出一张图**。
- 防呆：往库内导出必须被拒。
- 无镜像：导出要给人话，不能崩也不能假装成功。

### 3.3 没覆盖的（老实说）

- 没有单元测试框架（`node:test` 也没用），失败定位靠 `check()` 的 label。
- 网络层只测了失败路径，没有测「网慢 / 返回半截 JSON / 缓存目录不可写」。
- 没测并发（同时两次 `anim_fx_preview`）与超大 `ids` 数组。
- 没有视觉回归：渲出来的图画得对不对，靠人看，不靠断言。

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

- 自检 0.6 s；插件启动只读两个 JSON（279 KB + assets/catalog.json），不起服务。
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

合规上还有一条容易误会的事：`O_奥斯卡98部` 系列**不是影片截帧**，是拿 98 部影片当风格参照重画的插画
（`O55_甘地传` 画的是一场带红色吉祥物角色的风格化插画）。示例 MP4 是同一份提示词在两个模型下的成片。

## 7. 这次发布为仓库补的东西

- `README.md` 重写：三个数据源、18 个工具、三条流程、目录树、配置、自检、许可、审查结论。
- `LICENSE`（MIT，仅代码）+ `NOTICE.md`（素材条款、第三方 MIT、字体例外）。
- `.github/workflows/verify.yml`：push 跑一遍离线自检。
- `.gitignore`：忽略 `node_modules` / 导出目录 / `pixelfx/` 镜像。
- `lib/fx.js`：镜像路径解析顺序改为「配置 → 索引记录 → 插件根下 `pixelfx/`」，让单独 clone 也能用。
- `tools/verify.mjs`：镜像缺席时不再假失败，改测降级路径（117 → 111 项，全部通过）。

## 8. 改进清单（按性价比排序）

1. 拆 `lib/index.js`（900 行）→ `lib/tools/library.js`、`refs.js`、`fx.js`，卡片渲染抽 `render-card.js`。
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
node tools/verify.mjs                    # PASS — 117 项（无镜像时 PASS — 111 项）
node tools/verify.mjs --refs             # 需 DSH_REF_BASE 指向真实库：PASS — 129 项
node tools/build-fx.mjs                  # 重建索引：244 条 → 279 KB
~~~

以上命令的输出都已在本报告撰写时实际跑过，不是照抄文档。

发布后 CI 也验了一遍（`.github/workflows/verify.yml`，ubuntu-latest + node 22）：

- 第一次运行 **失败**，1 项：`anim_fx_preview 给出存在的 PNG 路径` —— 断言用的正则要求盘符 `[A-Za-z]:`，Linux 上只有 `/home/...`，所以永远匹配不上。
- 改法：不再用正则猜路径，直接拿拼好的绝对路径 `resolve(ROOT,'assets','fx','previews','fire','torch','contact.png')` 比对存在性。
- 之后两次运行均 **success**，日志里是 `PASS — 111 项检查全部通过`（CI 上没有 `pixelfx/` 镜像，走降级档）。
- 结论：CI 真的会跑、真的会拦问题；同时也暴露出「本机 117 项 / 远端 111 项」不是同一个覆盖面，镜像相关的那 6 项只在本地有。
