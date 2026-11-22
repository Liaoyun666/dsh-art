# 外接素材库：怎么用

前六个数据源（风格提示词 / 镜头卡 / 像素特效 / 设计工艺库…）都随包发布，素材就在 `assets/` 里。
这一组反过来：**素材本体在别人服务器上**，插件只负责「检索 → 看授权 → 落盘」。
四条工具，加上一份登记表：

| 工具 | 作用 |
|---|---|
| `anim_asset_sources` | 家底：哪些源、多少条、怎么分类、授权分布、外接位有哪些 |
| `anim_asset_search` | 跨源检索：关键词 + 分类 + 来源 + 色调 + 配色聚类 + 授权过滤 |
| `anim_asset_show` | 一条素材的详情：尺寸、主色板、来源页、各尺寸直链、授权说明 |
| `anim_asset_fetch` | 落到本地，返回 `localPath`（可交给看图工具或 `anim_extract`） |

另有 `anim_asset_guide`：把这份文档的要点直接读进上下文，适合模型自己拿不准的时候。

---

## 一、四个源是「集成」，九个是「外接」

`anim_asset_sources` 会实时打印这张表（条目数会随上游变化）：

| id | 方式 | 规模 | 授权 | 能做什么 |
|---|---|---|---|---|
| `liaoyunart` | 整份目录下载后本地搜 | 16,900+ 条 / 21 个来源 | 逐条标注 | 博物馆藏品、书法碑帖、古地图、图标矢量、PBR 材质、像素画、网页 UI、色板、航天影像 |
| `iconify` | 实时 JSON API | 200+ 图标集、20 万+ 图标 | 逐集 SPDX | 按关键词找图标，拿 SVG 直链（可改色 / 尺寸） |
| `ambientcg` | 实时 JSON API | 2,900+ PBR 材质 | CC0 | 材质预览图 + 整包 zip（Color/Normal/Roughness 通道） |
| `polyhaven` | 实时 JSON API | 998 HDRI / 871 贴图 / 522 模型 | CC0 | HDRI 与无缝贴图，各分辨率单项直链 |

**外接位**（只登记入口与授权，插件不代抓）：Kenney、OpenGameArt、LottieFiles、game-icons、
Google Fonts / Fontsource、Hero Patterns、Transparent Textures、Lospec、unDraw。
原因各不相同：没有稳定公开 API、下载要登录、或者整包是几十 MB 的 zip —— 到站点取更靠谱，
取回来的精灵图还能再进 `anim_extract` 拆元素。

---

## 二、四步走

### 1. 看家底

~~~text
anim_asset_sources
~~~

第一次会联网拉 `https://liaoyunart.com/data/catalog.js`（约 11MB），解析后写进
`<cacheDir>/liaoyunart-catalog.json`，**之后断网也能搜**。输出里的分类 id、来源 id、
配色聚类编号，就是下面检索参数的取值。

### 2. 检索

~~~text
anim_asset_search(query="水墨 山水", category="painting", tone="dark", limit=12)
anim_asset_search(provider="iconify", query="arrow right")
anim_asset_search(provider="ambientcg", query="wood floor")
anim_asset_search(provider="polyhaven", query="studio", kind="hdris")
~~~

- 多个词用空格分隔 = **同时命中**；每个词在标题(3) / 标签(2) / 作者(1.5) / 分类(1) / 来源(1) 里打分。
- 想配色合得上，传 `tone`（`dark` / `light` / `warm` / `cool` / `neutral`）或 `cluster`；
  色调是从每条素材的主色板算亮度与冷暖得出的，不是人工标注，粗筛够用。
- `license=cc0` 只要公有领域；`license=open` / `commercial` 排除 NC 与 ©。
- `sort=random` 随机抽（找灵感），`sort=large` 按文件大小。
- `provider=all` 四家一起查，输出末尾会列各源命中数。

### 3. 看授权（别跳）

~~~text
anim_asset_show(id="met_102715")
~~~

返回尺寸、作者、年代、主色板、标签、配色聚类、来源页、各尺寸直链，以及一行
**授权分级**：

| 分级 | 含义 | 能不能进交付物 |
|---|---|---|
| `cc0` | CC0 / 公有领域 | 可以，不用署名 |
| `attribution` | CC BY / OFL / MIT / Apache 等 | 可以，但要署名 + 带许可证文本 |
| `noncommercial` | CC BY-NC | 只有非营利项目能用 |
| `unknown` | © 转载 / 授权不明 | 只当参考看图 |

分级是按授权文本粗判的，判不准的一律归 `unknown`——**拿不准就以来源页为准**。

### 4. 落盘

~~~text
anim_asset_fetch(id="ambientcg:Wood051", variant="large")
~~~

默认原图；`variant` 可选 `thumb` / `small` / `large` / `orig`。命中缓存直接复用，
返回 `localPath`。之后的接法：

- 当参考图 → 直接把路径交给看图工具；
- 拆元素 / 出调色板 → `anim_extract(path=localPath)`；
- 配页面 → `anim_asset_show` 里的主色板抄进 CSS 变量；
- 进 Three.js / Blender → 贴图用 `large` 或 `orig`，别用 `thumb`。

---

## 三、和别的工具怎么搭

| 场景 | 顺序 |
|---|---|
| 做落地页 / 官网 | `anim_design_brief` 定调 → `anim_design_anchors` 锁风格 → `anim_asset_search(tone=…)` 找配图色系 → `anim_design_patterns` 抄版式 → `anim_design_audit` 自检 |
| 要图标 | `anim_asset_search(provider="iconify")` → `anim_asset_show` 拿 SVG 地址 → 内联进组件（`?color=` 改色） |
| 要材质 | `ambientcg` 拿整包 / `polyhaven` 拿单项直链 → 贴图进引擎 |
| 要像素画 | `anim_asset_search(category="pixel_game")` 或 `cluster=N` 定色板 → `anim_fx_*` 找现成特效 |
| 要插画空状态 | `category="storybook"` 或 `source="undraw"` → 下载后改主色 |

配色这件事有个顺序：**先用 `anim_design_brief` 定方案，再按 `tone`/`cluster` 找素材**。
反过来的话，会变成「素材什么色，页面就什么色」，最后整页没有主色。

---

## 四、离线、镜像与缓存

```text
config.assetBase      → 环境变量 DSH_ASSET_BASE → https://liaoyunart.com
config.assetCacheDir  → 缺省 <DSH_HOME|~/.dsh>/cache/anim-pack-assets
config.assetTimeoutMs → 缺省 25000ms（拉目录时最少给 60s）
```

- 目录缓存超过 7 天算过期：联网时自动刷新，断网时照旧用旧的（输出里会标「已过期」）。
- 想换自己的镜像：`assetBase` 指向能提供 `/data/catalog.js` 与 `/library/...` 的地址即可。
- 图片单个上限 80MB；下载走 `.part` 再改名，中断不会留半截文件。
- Iconify / ambientCG / Poly Haven 不缓存检索结果（本来就只有几十 KB），只缓存下载的图。

---

## 五、它不覆盖的事

- **不做生成**：这里只有现成素材，没有文生图（那要走 `generate_image`）。
- **不代抓外接位**：九个外接源只给入口，没有隐式下载。
- **不判版权**：分级是文本粗判，商用前请点进来源页看一眼；NC 与 © 的不要进交付物。
- **不保证上游稳定**：liaoyunart 是自建库，另外三家的 API 字段随上游变化；工具报错时会带上真实 URL，
  改 `lib/assets.js` 里对应的解析函数即可。
- **不下载整包**：ambientCG 的 zip、Poly Haven 的大文件只给直链，自己按需取。

---

## 六、常见问题

**Q：为什么 `anim_asset_search` 第一次很慢？**
A：在拉 11MB 的目录。之后有缓存，检索是纯内存操作。

**Q：`tone` 为什么和肉眼感觉不一致？**
A：它是按主色板平均亮度/冷暖算的粗标签；要精确就传 `cluster`（聚类是上游算好的）。

**Q：图标为什么没有缩略图文件？**
A：Iconify 直接给 SVG 地址，浏览器就能显示；`anim_asset_fetch` 存下来的是 `.svg`。

**Q：能在没有网的环境用吗？**
A：可以。只要之前拉过一次目录，liaoyunart 的检索与本地缓存过的图都还能用；
Iconify / ambientCG / Poly Haven 需要联网。

**Q：素材能直接进商用交付物吗？**
A：看授权分级。CC0 随便用；`attribution` 记得署名；`noncommercial` 与 `unknown` 别用。
