// lib/assets.js — 第七个数据源：外接素材库（external asset libraries）。
//
// 本包前六个数据源都是「随包发」的；这一组反过来——素材本体不在包里，插件只提供统一的
// 检索口：
//
//   1. liaoyunart.com  —— 自建美术参考图库：21 个博物馆/开源来源、16,900+ 条素材，
//      每条带来源页、授权、主色板、标签、配色聚类。目录是一份 data/catalog.js
//      （window.__CATALOG__ = {...}），首次拉下来落盘缓存，之后离线也能搜。
//   2. Iconify          —— 200+ 图标集、20 万+ 图标，公开 REST，按关键词检索后取 SVG。
//   3. ambientCG        —— CC0 PBR 材质，公开 JSON API，按关键词检索 + 下载贴图。
//   4. Poly Haven       —— CC0 的 HDRI / 贴图 / 模型，公开 JSON API。
//   5. 其余社区库（Kenney / OpenGameArt / LottieFiles / game-icons 等）只登记入口与授权，
//      不代抓——它们是「外接」，不是「集成」，工具会如实说明为什么。
//
// 设计原则和 refs.js 一致：只用 node: 内置模块；网络断了给一句人话，绝不抛到宿主；
// 每条结果都带授权，非商用/© 的条目明确标出来，让人自己判断能不能用。

import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** liaoyunart 的缺省地址（config.assetBase → 环境变量 DSH_ASSET_BASE → 这里）。 */
export const LIAO_DEFAULT_BASE =
  (process.env.DSH_ASSET_BASE ?? '').trim().replace(/\/+$/, '') || 'https://liaoyunart.com'

export const DEFAULT_TIMEOUT_MS = 25000
export const MAX_SEARCH_LIMIT = 60
export const MAX_FETCH_BYTES = 80 * 1024 * 1024
/** 目录缓存多久算新：超过就下次联网时顺手刷新，但离线仍然用旧目录。 */
export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const ICONIFY_BASE = 'https://api.iconify.design'
export const AMBIENTCG_API = 'https://ambientcg.com/api/v2/full_json'
export const POLYHAVEN_API = 'https://api.polyhaven.com'

/** 素材源登记表：mode=api 能检索能取；link 只给入口；catalog 是整份目录拉下来本地搜。 */
export const PROVIDERS = [
  {
    id: 'liaoyunart',
    name: '美术参考图库 liaoyunart.com',
    mode: 'catalog',
    kind: 'mixed',
    homepage: 'https://liaoyunart.com',
    license: '逐条标注（CC0 / 公有领域 / CC BY / CC BY-SA / 少量 CC BY-NC 与 © 转载）',
    blurb: '21 个来源、16,900+ 条：博物馆藏品、书法碑帖、古地图、图标矢量、PBR 材质、像素画、网页 UI、色板、航天影像。可离线缓存整份目录后按关键词/分类/配色聚类检索。',
  },
  {
    id: 'iconify',
    name: 'Iconify 图标库',
    mode: 'api',
    kind: 'icon',
    homepage: 'https://icon-sets.iconify.design/',
    license: '依图标集（Apache-2.0 / MIT / CC BY 4.0 / OFL 等，逐集标注）',
    blurb: '200+ 图标集、20 万+ 图标，含 Material Symbols / Lucide / Tabler / Phosphor 等。检索返回 <集>:<图标>，可直接取 SVG（可改颜色与尺寸）。',
  },
  {
    id: 'ambientcg',
    name: 'ambientCG 材质',
    mode: 'api',
    kind: 'texture',
    homepage: 'https://ambientcg.com/',
    license: 'CC0 1.0（可商用、免署名）',
    blurb: 'PBR 材质贴图（石材、木纹、金属、布料、地面…），每套含 Color/Normal/Roughness 等通道；插件取预览图与贴图直链，整包 zip 在详情里给。',
  },
  {
    id: 'polyhaven',
    name: 'Poly Haven',
    mode: 'api',
    kind: 'texture',
    homepage: 'https://polyhaven.com/',
    license: 'CC0（可商用、免署名）',
    blurb: 'HDRI 环境光、无缝贴图、模型。检索走分类与标签过滤；详情给出各分辨率贴图/HDRI 的直链。',
  },
  {
    id: 'kenney',
    name: 'Kenney（外接）',
    mode: 'link',
    kind: 'sprite',
    homepage: 'https://kenney.nl/assets',
    license: 'CC0',
    blurb: '游戏 UI、粒子、2D 精灵、音效的 CC0 合集。没有公开检索 API，且整包是 zip：到站点挑包下载后，用 anim_extract 拆元素。',
  },
  {
    id: 'opengameart',
    name: 'OpenGameArt（外接）',
    mode: 'link',
    kind: 'sprite',
    homepage: 'https://opengameart.org/',
    license: '逐条（CC0 / CC BY / CC BY-SA / GPL）',
    blurb: '老牌开源游戏素材站。liaoyunart 目录里已镜像 176 条（tileset、像素画等）；其余条目到站点取。',
  },
  {
    id: 'lottiefiles',
    name: 'LottieFiles（外接）',
    mode: 'link',
    kind: 'motion',
    homepage: 'https://lottiefiles.com/free-animations',
    license: '逐条（Lottie Simple License / CC0 混用）',
    blurb: '现成 Lottie 动效（JSON），适合网页/App 的加载、成功、空状态动效。下载需登录，所以只登记入口。',
  },
  {
    id: 'game-icons',
    name: 'game-icons.net（外接）',
    mode: 'link',
    kind: 'icon',
    homepage: 'https://game-icons.net/',
    license: 'CC BY 3.0（需署名）',
    blurb: '4,000+ 游戏/奇幻主题单色图标。仓库在 GitHub，克隆不便，建议从站点按包下载后放进项目。',
  },
  {
    id: 'google-fonts',
    name: 'Google Fonts / Fontsource（外接）',
    mode: 'link',
    kind: 'font',
    homepage: 'https://fonts.google.com/',
    license: '多数 OFL 1.1，少数 Apache-2.0（逐字族）',
    blurb: '1,600+ 字族。取法有两种：https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400 拿 @font-face（里面就是 woff2 直链）；或者 unpkg 上的 Fontsource 镜像，例如 https://unpkg.com/@fontsource/roboto@5.0.0/400.css。不做成工具是因为字体文件动辄几十 MB、还要自己托管，交给人决定。',
  },
  {
    id: 'hero-patterns',
    name: 'Hero Patterns（外接）',
    mode: 'link',
    kind: 'pattern',
    homepage: 'https://heropatterns.com/',
    license: 'CC BY 4.0（Steve Schoger，需署名）',
    blurb: '约 100 张可平铺的 SVG 几何图案，直接当 section 背景。没有公开 API：站点上挑一张，复制 SVG 内联进 CSS（改 fill 就能换色）。',
  },
  {
    id: 'transparent-textures',
    name: 'Transparent Textures（外接）',
    mode: 'link',
    kind: 'pattern',
    homepage: 'https://transparenttextures.com/',
    license: 'CC BY 3.0（需署名）',
    blurb: '数百张透明 PNG 纹理，用来给纯色背景加一层噪点/纸纹。无检索 API，直链形如 https://transparenttextures.com/patterns/diagmonds-light.png，按名录拼 URL。',
  },
  {
    id: 'lospec',
    name: 'Lospec 调色板（外接）',
    mode: 'link',
    kind: 'palette',
    homepage: 'https://lospec.com/palette-list',
    license: '逐调色板（多数 CC0 / CC BY，页面上标）',
    blurb: '数千个像素/通用配色板，做像素画、复古 UI、数据可视化取色很顺手。liaoyunart 目录里已镜像 240 条调色板（kind=palette）；其余到站点按 slug 取。',
  },
  {
    id: 'undraw',
    name: 'unDraw（外接）',
    mode: 'link',
    kind: 'illustration',
    homepage: 'https://undraw.co/illustrations',
    license: '免署名商用，但要求改主色（品牌条款特殊）',
    blurb: '数千张单色 SVG 插画，适合空状态、引导页、说明段。liaoyunart 里镜像了 260 条；原站下载要过它的品牌条款，所以只登记入口。',
  },
]

export function providerOf(id) {
  return PROVIDERS.find((row) => row.id === id) || null
}

// ── 配置 ────────────────────────────────────────────────────────────────────

export function defaultCacheDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'cache', 'anim-pack-assets')
}

export function normalizeAssetConfig(raw, fallback) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const pick = (key) => (typeof input[key] === 'string' ? input[key].trim() : '')
  const base = (pick('assetBase') || (fallback && fallback.base) || LIAO_DEFAULT_BASE).replace(/\/+$/, '')
  const cacheDir = pick('assetCacheDir') || (fallback && fallback.cacheDir) || defaultCacheDir()
  const rawTimeout = Number(input.assetTimeoutMs)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(180000, Math.max(2000, Math.round(rawTimeout)))
    : ((fallback && fallback.timeoutMs) || DEFAULT_TIMEOUT_MS)
  return { base, cacheDir, timeoutMs }
}

export function assetCacheFile(cfg) {
  return join(cfg.cacheDir, 'liaoyunart-catalog.json')
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function networkHint(error) {
  const code = error && (error.cause?.code || error.code)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败'
  if (code === 'ECONNREFUSED') return '连接被拒绝'
  if (code === 'ETIMEDOUT' || (error && error.name === 'TimeoutError')) return '连接超时'
  if (error && error.name === 'AbortError') return '请求超时'
  return String((error && error.message) || error || '未知错误')
}

async function getJson(url, cfg) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!response.ok) {
      const failure = new Error('素材源返回 HTTP ' + response.status + '（' + url + '）')
      failure.status = response.status
      throw failure
    }
    return await response.json()
  } catch (error) {
    if (error && error.status) throw error
    const failure = new Error('连不上素材源 ' + url + '（' + networkHint(error) + '）。离线时仍可用本包自带素材。')
    failure.network = true
    throw failure
  } finally {
    clearTimeout(timer)
  }
}

// ── liaoyunart：目录解析、索引、检索（纯函数，verify 直接测）─────────────────

/** data/catalog.js 是 "window.__CATALOG__ = {...};"，剥壳后 JSON.parse。 */
export function parseLiaoCatalog(text) {
  const source = String(text ?? '')
  const at = source.indexOf('{')
  if (at === -1) throw new Error('目录文件里没有 JSON 对象')
  let body = source.slice(at).trim()
  if (body.endsWith(';')) body = body.slice(0, -1)
  const catalog = JSON.parse(body)
  if (!catalog || !Array.isArray(catalog.items)) throw new Error('目录缺 items 数组')
  return catalog
}

/** 授权粗分级：cc0 / attribution / noncommercial / unknown —— 决定工具里怎么提醒。 */
export function licenseClass(text) {
  const s = String(text ?? '').toLowerCase()
  if (!s) return 'unknown'
  if (/©|all rights|in copyright|rightsstatements\.org\/vocab\/inc|版权/.test(s)) return 'unknown'
  // 注意：nc 要按词判断，否则 rightsstatements 的 InC（未授权）会被当成 NonCommercial。
  if (/(^|[^a-z])nc([^a-z]|$)|non-?commercial|by-nc|非商业/.test(s)) return 'noncommercial'
  if (/cc0|public domain|公有领域|publicdomain|pdm/.test(s)) return 'cc0'
  if (/cc by|attribution|署名|ofl|open font|mit|apache|isc|gpl|mpl|oga-by/.test(s)) return 'attribution'
  return 'unknown'
}

const LICENSE_NOTE = {
  cc0: 'CC0 / 公有领域：可商用、免署名',
  attribution: '需署名（CC BY / OFL / MIT 等）：商用可以，署名与许可证文本要带上',
  noncommercial: '非商业（NC）：商用项目别用',
  unknown: '授权不明或为 © 转载：只用来看参考，别直接进交付物',
}

export function licenseNote(text) {
  return LICENSE_NOTE[licenseClass(text)] || LICENSE_NOTE.unknown
}

/** 从主色板粗判色调，供 tone 过滤（dark / light / warm / cool）。 */
export function assetTone(palette) {
  const colors = Array.isArray(palette) ? palette.filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))) : []
  if (colors.length === 0) return 'unknown'
  let lum = 0
  let warm = 0
  for (const hex of colors) {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    warm += r - b
  }
  lum /= colors.length
  warm /= colors.length
  if (lum < 0.32) return 'dark'
  if (lum > 0.72) return 'light'
  return warm > 0.06 ? 'warm' : warm < -0.06 ? 'cool' : 'neutral'
}

/** 目录 → 索引：保留原始条目，补上来源名/分类名/授权分级/色调，建 id 表。 */
export function indexLiaoCatalog(catalog) {
  const taxonomy = new Map()
  for (const row of Array.isArray(catalog.taxonomy) ? catalog.taxonomy : []) taxonomy.set(row.id, row)
  const sources = new Map()
  for (const row of Array.isArray(catalog.sources) ? catalog.sources : []) sources.set(row.id, row)
  const clusters = new Map()
  for (const row of Array.isArray(catalog.clusters) ? catalog.clusters : []) clusters.set(Number(row.id), row)
  const groups = Array.isArray(catalog.groups) ? catalog.groups : []
  const licenses = Array.isArray(catalog.licenses) ? catalog.licenses : []

  const items = []
  const byId = new Map()
  for (const raw of catalog.items) {
    const category = taxonomy.get(raw.category)
    const source = sources.get(raw.source)
    const license = typeof raw.lic === 'number' ? (licenses[raw.lic] ?? '') : ''
    const item = {
      ...raw,
      provider: 'liaoyunart',
      license,
      licenseClass: licenseClass(license),
      tone: assetTone(raw.palette),
      categoryLabel: category?.label ?? raw.category ?? '',
      group: category?.group ?? '',
      sourceName: source?.name ?? raw.source ?? '',
      clusterName: clusters.get(Number(raw.cluster))?.name ?? '',
    }
    // 检索用的归一化字段：非枚举属性，不会跟着 JSON.stringify 进缓存或输出。
    Object.defineProperty(item, '_haystack', {
      value: {
        title: String(item.title ?? '').toLowerCase(),
        tags: (Array.isArray(item.tags) ? item.tags : []).join(' ').toLowerCase(),
        creator: String(item.creator ?? '').toLowerCase(),
        cat: (String(item.categoryLabel ?? '') + ' ' + String(item.category ?? '')).toLowerCase(),
        src: (String(item.sourceName ?? '') + ' ' + String(item.source ?? '')).toLowerCase(),
      },
      enumerable: false,
    })
    items.push(item)
    byId.set(item.id, item)
  }
  return { catalog, items, byId, taxonomy, sources, groups, clusters, licenses }
}

/** 单个检索词的命中分：标题 3 / 标签 2 / 作者 1.5 / 分类与来源 1。 */
function tokenHit(item, token) {
  let hit = 0
  if (item._haystack.title.includes(token)) hit += 3
  if (item._haystack.tags.includes(token)) hit += 2
  if (item._haystack.creator.includes(token)) hit += 1.5
  if (item._haystack.cat.includes(token)) hit += 1
  if (item._haystack.src.includes(token)) hit += 1
  return hit
}

/**
 * 按同义词组打分：组内取最高分（水墨 或 ink 命中都算），组间必须全部命中。
 * 返回 { score, matched }：matched 是命中的组数，用来在放宽模式下排序。
 */
function liaoScore(item, groups) {
  if (groups.length === 0) return { score: 1, matched: 0 }
  let total = 0
  let matched = 0
  for (const group of groups) {
    let best = 0
    for (const token of group) {
      const hit = tokenHit(item, token)
      if (hit > best) best = hit
    }
    if (best === 0) return { score: 0, matched }
    matched += 1
    total += best
  }
  return { score: total, matched }
}

/**
 * 中文 → 英文同义词表。
 *
 * liaoyunart 的标题 / 标签 / 作者全是英文（博物馆与开源来源的原始元数据），所以直接搜
 * 「水墨」「材质」这类中文词时，严格「每个词都要命中」只会得到 0 条。这张表把常见美术 /
 * 设计中文词换成一到三个英文检索词，检索时同义词组内「任一命中」即可。
 * 只放名词与题材词；不放虚词，避免误命中。
 */
export const QUERY_SYNONYMS = {
  水墨: ['ink'], 墨: ['ink'], 山水: ['landscape'], 风景: ['landscape', 'scenery'],
  肖像: ['portrait'], 人物: ['figure'], 油画: ['oil'], 版画: ['print'], 素描: ['drawing', 'sketch'],
  书法: ['calligraphy'], 碑帖: ['rubbing'], 地图: ['map'], 建筑: ['architecture'],
  花卉: ['flower'], 花: ['flower'], 植物: ['plant'], 动物: ['animal'], 鸟: ['bird'],
  鱼: ['fish'], 龙: ['dragon'], 神像: ['deity'], 佛像: ['buddha'], 宗教: ['religion'],
  敦煌: ['dunhuang'], 中国: ['china', 'chinese'], 日本: ['japan', 'japanese'],
  欧洲: ['europe'], 埃及: ['egypt'], 希腊: ['greek'], 罗马: ['roman'], 波斯: ['persia'],
  印度: ['india'], 伊斯兰: ['islamic'], 装饰: ['ornament'], 纹样: ['pattern', 'motif'],
  图案: ['pattern', 'motif'], 几何: ['geometric'], 图标: ['icon'], 矢量: ['vector'],
  像素: ['pixel'], 色板: ['palette'], 配色: ['palette', 'color'], 材质: ['material'],
  纹理: ['texture'], 贴图: ['texture'], 木: ['wood'], 石: ['stone'], 金属: ['metal'],
  布: ['fabric', 'textile'], 纸: ['paper'], 墙: ['wall'], 地面: ['floor'], 天空: ['sky'],
  云: ['cloud'], 夜景: ['night'], 室内: ['interior'], 城市: ['city'], 太空: ['space'],
  宇宙: ['space', 'universe'], 星球: ['planet'], 月球: ['moon'], 火星: ['mars'],
  海报: ['poster'], 封面: ['cover'], 漫画: ['comic'], 动画: ['anime'], 绘本: ['storybook'],
  游戏: ['game'], 复古: ['retro', 'vintage'], 极简: ['minimal'], 手绘: ['hand-drawn', 'drawing'],
  水彩: ['watercolor'], 海: ['sea'], 山: ['mountain'], 森林: ['forest'], 摄影: ['photograph'],
  雕塑: ['sculpture'], 陶瓷: ['ceramic'], 服装: ['costume'], 盔甲: ['armor'], 乐器: ['instrument'],
  甲胄: ['armor'], 壁画: ['mural', 'fresco'], 手稿: ['manuscript'], 星图: ['star', 'chart'],
  // 界面 / 图标类（做前端找图标时最常搜的词）
  箭头: ['arrow'], 按钮: ['button'], 搜索: ['search'], 用户: ['user'], 设置: ['settings'],
  首页: ['home'], 菜单: ['menu'], 返回: ['back'], 下载: ['download'], 上传: ['upload'],
  播放: ['play'], 音乐: ['music'], 相机: ['camera'], 电话: ['phone'], 邮件: ['mail'],
  星星: ['star'], 心形: ['heart'], 勾: ['check'], 叉: ['close'], 加号: ['plus'],
  减号: ['minus'], 警告: ['warning'], 提示: ['info'], 时钟: ['clock'], 日历: ['calendar'],
  文件: ['file'], 文件夹: ['folder'], 分享: ['share'], 位置: ['location'], 消息: ['message'],
  锁: ['lock'], 解锁: ['unlock'], 眼睛: ['eye'], 编辑: ['edit'], 删除: ['trash', 'delete'],
  刷新: ['refresh'], 加载: ['loading'], 筛选: ['filter'], 排序: ['sort'], 全屏: ['fullscreen'],
}

/** 把查询拆成「同义词组」：每组内任一命中即可，组与组之间仍要同时满足。 */
export function expandQueryTokens(query) {
  const raw = splitTokens(query)
  const groups = raw.map((token) => {
    const syn = QUERY_SYNONYMS[token]
    return Array.isArray(syn) && syn.length > 0 ? [token, ...syn] : [token]
  })
  const expanded = groups
    .filter((group) => group.length > 1)
    .map((group) => group[0] + '→' + group.slice(1).join('/'))
  return { raw, groups, expanded }
}

function splitTokens(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[\s,，、/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

/** 检索 liaoyunart 索引。所有过滤条件都是「同时满足」。 */
export function searchLiao(index, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const { raw, groups, expanded } = expandQueryTokens(opts.query)
  // 中文查询才允许「部分命中」兜底：中文靠同义词表换英文，翻译必然有损；
  // 英文查询保持严格（每个词都要命中），不然 "wood rome" 这种会误命中一堆。
  const looseQuery = /[\u4e00-\u9fff]/.test(String(opts.query ?? ''))
  const category = String(opts.category ?? '').trim().toLowerCase()
  const group = String(opts.group ?? '').trim().toLowerCase()
  const source = String(opts.source ?? '').trim().toLowerCase()
  const kind = String(opts.kind ?? '').trim().toLowerCase()
  const tone = String(opts.tone ?? '').trim().toLowerCase()
  const cluster = opts.cluster === 0 || opts.cluster ? Number(opts.cluster) : null
  const licenseMode = String(opts.license ?? '').trim().toLowerCase()
  const limit = clampInt(opts.limit, 20, 1, MAX_SEARCH_LIMIT)
  const offset = clampInt(opts.offset, 0, 0, 1000000)
  const sort = String(opts.sort ?? '').trim().toLowerCase()

  const rows = []
  const partial = []
  for (const item of index.items) {
    if (category && String(item.category).toLowerCase() !== category &&
      !String(item.categoryLabel).toLowerCase().includes(category)) continue
    if (group && String(item.group).toLowerCase() !== group) continue
    if (source && String(item.source).toLowerCase() !== source) continue
    if (kind && String(item.kind).toLowerCase() !== kind) continue
    if (tone && item.tone !== tone) continue
    if (cluster !== null && Number(item.cluster) !== cluster) continue
    if (licenseMode === 'open' && item.licenseClass !== 'cc0' && item.licenseClass !== 'attribution') continue
    if (licenseMode === 'commercial' && item.licenseClass !== 'cc0' && item.licenseClass !== 'attribution') continue
    if (licenseMode === 'cc0' && item.licenseClass !== 'cc0') continue
    const scored = liaoScore(item, groups)
    if (scored.score > 0) {
      rows.push({ item, score: scored.score })
    } else if (looseQuery && groups.length > 0 && scored.matched >= Math.ceil(groups.length / 2)) {
      // 命中一半以上的词：留作放宽候选，严格档空手时才用（避免单词误命中淹结果）。
      partial.push({ item, score: scored.matched })
    }
  }
  let relaxed = false
  if (rows.length === 0 && partial.length > 0) {
    relaxed = true
    rows.push(...partial)
  }
  if (sort === 'random') {
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rows[i], rows[j]] = [rows[j], rows[i]]
    }
  } else if (sort === 'large') {
    rows.sort((a, b) => (b.item.bytes || 0) - (a.item.bytes || 0))
  } else {
    rows.sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
  }
  return {
    total: rows.length,
    rows: rows.slice(offset, offset + limit),
    tokens: raw,
    expanded,
    relaxed,
  }
}

// ── liaoyunart：联网拉目录 + 缓存 ─────────────────────────────────────────

/** 拉目录（成功写缓存；失败退回缓存并标 stale）。 */
export async function fetchLiaoCatalog(cfg, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const file = assetCacheFile(cfg)
  const url = cfg.base.replace(/\/+$/, '') + '/data/catalog.js'
  void opts
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(cfg.timeoutMs, 60000))
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/javascript, application/javascript, */*' } })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw new Error('目录返回 HTTP ' + response.status)
    const text = await response.text()
    const catalog = parseLiaoCatalog(text)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(catalog))
    return { catalog, cached: false, fetchedAt: Date.now(), stale: false }
  } catch (error) {
    try {
      const text = await readFile(file, 'utf8')
      const catalog = JSON.parse(text)
      const age = Date.now() - (await stat(file)).mtimeMs
      return { catalog, cached: true, fetchedAt: Date.now() - age, stale: age > CATALOG_TTL_MS, error: networkHint(error) }
    } catch {
      const failure = new Error('liaoyunart 目录取不下来（' + networkHint(error) + '），本地也还没有缓存。' +
        '先联网跑一次 anim_asset_sources 或 anim_asset_search（会自动拉目录并缓存到 ' + file + '）；' +
        '或者设 config.assetBase / DSH_ASSET_BASE 指向你自己的镜像。')
      failure.network = true
      throw failure
    }
  }
}

// ── Iconify ────────────────────────────────────────────────────────────────

let iconifyCollections = null

export async function iconifyCollectionsMap(cfg) {
  if (iconifyCollections) return iconifyCollections
  const data = await getJson(ICONIFY_BASE + '/collections?pretty=0', cfg)
  const map = new Map()
  for (const [prefix, row] of Object.entries(data || {})) {
    map.set(prefix, {
      prefix,
      name: row.name || prefix,
      total: row.total ?? 0,
      license: row.license?.title || row.license?.spdx || '',
      author: row.author?.name || '',
      samples: Array.isArray(row.samples) ? row.samples : [],
      category: row.category || '',
    })
  }
  iconifyCollections = map
  return map
}

export function iconifySvgUrl(id, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const [prefix, name] = String(id ?? '').split(':')
  if (!prefix || !name) return ''
  const params = new URLSearchParams()
  if (opts.height) params.set('height', String(clampInt(opts.height, 0, 8, 1024)))
  if (opts.color) params.set('color', String(opts.color))
  const query = params.toString()
  return ICONIFY_BASE + '/' + encodeURIComponent(prefix) + '/' + encodeURIComponent(name) + '.svg' + (query ? '?' + query : '')
}

/** Iconify 检索：返回 [{id, prefix, name, collection, license}]。 */
export async function searchIconify(cfg, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const query = String(opts.query ?? '').trim()
  if (!query) throw new Error('Iconify 检索要给关键词（英文效果最好，例如 arrow / rocket / settings）。')
  const limit = clampInt(opts.limit, 24, 1, MAX_SEARCH_LIMIT)
  const params = new URLSearchParams({ query, limit: String(limit) })
  if (opts.prefix) params.set('prefix', String(opts.prefix))
  const data = await getJson(ICONIFY_BASE + '/search?' + params.toString(), cfg)
  const collections = await iconifyCollectionsMap(cfg).catch(() => new Map())
  const ids = Array.isArray(data?.icons) ? data.icons : []
  const total = Number(data?.total) || ids.length
  return {
    total,
    rows: ids.map((id) => {
      const [prefix, name] = String(id).split(':')
      const col = collections.get(prefix)
      return {
        id: 'iconify:' + id,
        provider: 'iconify',
        key: id,
        prefix,
        name,
        title: (col?.name || prefix) + ' · ' + name,
        creator: col?.author || '',
        license: col?.license || '',
        licenseClass: licenseClass(col?.license || ''),
        kind: 'icon',
        collection: col?.name || prefix,
        category: 'icon',
        urls: { thumb: iconifySvgUrl(id, { height: 64 }), orig: iconifySvgUrl(id) },
      }
    }),
  }
}

// ── ambientCG ──────────────────────────────────────────────────────────────

function ambientcgItem(row) {
  const prev = row.previewImage || {}
  const pickPreview = (size) => prev[size + '-PNG'] || prev[size + '-JPG-FFFFFF'] || ''
  return {
    id: 'ambientcg:' + row.assetId,
    provider: 'ambientcg',
    key: row.assetId,
    title: row.displayName || row.assetId,
    creator: 'ambientCG / Lennart Demes',
    license: 'CC0 1.0',
    licenseClass: 'cc0',
    kind: 'texture',
    category: row.dataType || 'Material',
    tags: Array.isArray(row.tags) ? row.tags : [],
    page: 'https://ambientcg.com/view?id=' + encodeURIComponent(row.assetId),
    urls: {
      thumb: pickPreview(256) || pickPreview(512) || '',
      orig: pickPreview(2048) || pickPreview(1024) || '',
    },
    downloads: [],
  }
}

export async function searchAmbientCG(cfg, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const query = String(opts.query ?? '').trim()
  const limit = clampInt(opts.limit, 24, 1, MAX_SEARCH_LIMIT)
  const params = new URLSearchParams({ type: 'Material', limit: String(limit), include: 'previewData' })
  if (query) params.set('q', query)
  if (opts.sort) params.set('sort', String(opts.sort))
  const data = await getJson(AMBIENTCG_API + '?' + params.toString(), cfg)
  const assets = Array.isArray(data?.foundAssets) ? data.foundAssets : []
  return {
    total: Number(data?.numberOfResults) || assets.length,
    rows: assets.map(ambientcgItem),
  }
}

/** ambientCG 详情：补上整包 zip 与各通道贴图的直链。 */
export async function ambientcgDetail(cfg, assetId) {
  const params = new URLSearchParams({ type: 'Material', assetId: String(assetId), include: 'downloadData,previewData' })
  const data = await getJson(AMBIENTCG_API + '?' + params.toString(), cfg)
  const row = Array.isArray(data?.foundAssets) ? data.foundAssets[0] : null
  if (!row) return null
  const item = ambientcgItem(row)
  item.downloads = (Array.isArray(row.downloadFolders) ? row.downloadFolders : []).map((folder) => ({
    resolution: folder?.fileName || folder?.name || '',
    zip: folder?.downloadLink || folder?.zip || '',
  }))
  return item
}

// ── Poly Haven ─────────────────────────────────────────────────────────────

const polyCache = new Map()

async function polyAssets(cfg, type) {
  const key = type || 'all'
  if (polyCache.has(key)) return polyCache.get(key)
  const url = POLYHAVEN_API + '/assets' + (type ? '?t=' + encodeURIComponent(type) : '')
  const data = await getJson(url, cfg)
  polyCache.set(key, data || {})
  return polyCache.get(key)
}

export async function searchPolyHaven(cfg, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const query = String(opts.query ?? '').trim().toLowerCase()
  const type = String(opts.kind ?? opts.type ?? '').trim().toLowerCase()
  const limit = clampInt(opts.limit, 20, 1, MAX_SEARCH_LIMIT)
  const allowed = ['hdris', 'textures', 'models', 'all']
  const want = allowed.includes(type) ? (type === 'all' ? '' : type) : ''
  const types = want ? [want] : ['textures', 'hdris', 'models']
  const rows = []
  for (const t of types) {
    let data
    try {
      data = await polyAssets(cfg, t)
    } catch {
      continue
    }
    for (const [id, row] of Object.entries(data || {})) {
      const haystack = [id, row?.name, ...(Array.isArray(row?.tags) ? row.tags : []), row?.category].join(' ').toLowerCase()
      if (query && !query.split(/\s+/).every((token) => haystack.includes(token))) continue
      rows.push({
        id: 'polyhaven:' + id,
        provider: 'polyhaven',
        key: id,
        title: row?.name || id,
        creator: Object.keys(row?.authors || {}).join('、') || 'Poly Haven',
        license: 'CC0',
        licenseClass: 'cc0',
        kind: t === 'hdris' ? 'hdri' : t === 'models' ? 'model' : 'texture',
        category: row?.category || '',
        tags: Array.isArray(row?.tags) ? row.tags : [],
        page: 'https://polyhaven.com/a/' + id,
        urls: {
          thumb: 'https://cdn.polyhaven.com/asset_img/thumbs/' + id + '.png?width=256&height=256',
        },
        maxResolution: Array.isArray(row?.max_resolution) ? row.max_resolution : [],
      })
      if (rows.length >= limit) break
    }
    if (rows.length >= limit) break
  }
  return { total: rows.length, rows: rows.slice(0, limit) }
}

/** Poly Haven 详情：取 /files/<id>，按通道挑出常用贴图/HDRI 直链。 */
export async function polyhavenDetail(cfg, id) {
  const data = await getJson(POLYHAVEN_API + '/files/' + encodeURIComponent(id), cfg)
  if (!data || typeof data !== 'object') return null
  const links = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.url === 'string' && /\.(png|jpe?g|exr|hdr|glb|blend|zip)$/i.test(node.url)) {
      links.push({ path, url: node.url, size: node.size ?? null })
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'url' || key === 'size') continue
      walk(value, path ? path + '/' + key : key)
    }
  }
  walk(data, '')
  const pickBy = (pattern) => links.find((row) => pattern.test(row.path))
  const hero = pickBy(/Diffuse|diffuse|Color|color|albedo/i) || pickBy(/\.(png|jpe?g)$/i)
  return {
    id: 'polyhaven:' + id,
    provider: 'polyhaven',
    key: id,
    title: id,
    license: 'CC0',
    licenseClass: 'cc0',
    page: 'https://polyhaven.com/a/' + id,
    urls: {
      thumb: 'https://cdn.polyhaven.com/asset_img/thumbs/' + id + '.png?width=512&height=512',
      orig: hero?.url || '',
    },
    links: links.slice(0, 24),
    linkCount: links.length,
  }
}

// ── 统一检索 / 详情 / 下载 ─────────────────────────────────────────────────

/** 前缀式 id：liaoyunart 省掉前缀；iconify:<集>:<名>；ambientcg:<资产>；polyhaven:<资产>。 */
export function splitAssetId(value) {
  const text = String(value ?? '').trim()
  const at = text.indexOf(':')
  if (at === -1) return { provider: 'liaoyunart', key: text, id: 'liaoyunart:' + text }
  const provider = text.slice(0, at).toLowerCase()
  const key = text.slice(at + 1)
  return { provider, key, id: text }
}

/**
 * 跨源检索。provider 省略时查 liaoyunart（整库目录，最全），
 * 传 all 则四家都查（会多几次网络请求）。
 */
export async function searchAssets(cfg, liaoIndexLoader, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const wanted = String(opts.provider ?? 'liaoyunart').trim().toLowerCase()
  const limit = clampInt(opts.limit, 16, 1, MAX_SEARCH_LIMIT)
  const notes = []
  let liaoRows = []
  let liaoTotal = 0
  let iconRows = []
  let texRows = []

  if (wanted === 'liaoyunart' || wanted === 'liao' || wanted === 'all') {
    const index = await liaoIndexLoader()
    const result = searchLiao(index, { ...opts, limit })
    liaoRows = result.rows.map((row) => row.item)
    liaoTotal = result.total
    const meta = { tokens: result.tokens, expanded: result.expanded, relaxed: result.relaxed }
    if (wanted !== 'all') return { provider: 'liaoyunart', total: result.total, rows: liaoRows, notes, ...meta }
    notes.push('liaoyunart：' + result.total + ' 条命中')
  }
  if (wanted === 'iconify' || wanted === 'all') {
    try {
      const result = await searchIconify(cfg, { query: opts.query, prefix: opts.prefix, limit })
      if (wanted !== 'all') return { provider: 'iconify', total: result.total, rows: result.rows, notes }
      notes.push('iconify：' + result.total + ' 条命中（本页 ' + result.rows.length + '）')
      iconRows = result.rows
    } catch (error) {
      notes.push('iconify 没查成：' + String(error?.message ?? error))
    }
  }
  if (wanted === 'ambientcg' || wanted === 'all') {
    try {
      const result = await searchAmbientCG(cfg, { query: opts.query, limit })
      if (wanted !== 'all') return { provider: 'ambientcg', total: result.total, rows: result.rows, notes }
      notes.push('ambientcg：' + result.total + ' 条命中')
      texRows = result.rows
    } catch (error) {
      notes.push('ambientcg 没查成：' + String(error?.message ?? error))
    }
  }
  if (wanted === 'polyhaven' || wanted === 'all') {
    try {
      const result = await searchPolyHaven(cfg, { query: opts.query, kind: opts.kind, limit })
      if (wanted !== 'all') return { provider: 'polyhaven', total: result.total, rows: result.rows, notes }
      notes.push('polyhaven：' + result.total + ' 条命中')
      texRows = texRows.concat(result.rows)
    } catch (error) {
      notes.push('polyhaven 没查成：' + String(error?.message ?? error))
    }
  }
  if (wanted === 'all') {
    const merged = [...liaoRows, ...iconRows, ...texRows].slice(0, limit)
    return { provider: 'all', total: liaoTotal + iconRows.length + texRows.length, rows: merged, notes }
  }
  throw new Error('不认识的素材源「' + wanted + '」。可选：' + PROVIDERS.filter((row) => row.mode !== 'link').map((row) => row.id).join(' / ') + '，或 all。')
}

/** 详情：按前缀分派。 */
export async function showAsset(cfg, liaoIndexLoader, id) {
  const parts = splitAssetId(id)
  if (parts.provider === 'liaoyunart' || parts.provider === 'liao') {
    const index = await liaoIndexLoader()
    const item = index.byId.get(parts.key)
    if (!item) throw new Error('liaoyunart 里没有 id 为「' + parts.key + '」的素材；先 anim_asset_search 搜关键词或分类。')
    return item
  }
  if (parts.provider === 'iconify') {
    const [prefix, name] = parts.key.split(':')
    if (!prefix || !name) throw new Error('Iconify id 要写成 iconify:<图标集>:<图标名>，例如 iconify:mdi:rocket。')
    const collections = await iconifyCollectionsMap(cfg)
    const col = collections.get(prefix)
    return {
      id: parts.id,
      provider: 'iconify',
      key: parts.key,
      title: (col?.name || prefix) + ' · ' + name,
      creator: col?.author || '',
      license: col?.license || '',
      licenseClass: licenseClass(col?.license || ''),
      kind: 'icon',
      category: 'icon',
      page: 'https://icon-sets.iconify.design/' + prefix + '/?icon=' + encodeURIComponent(name),
      urls: { thumb: iconifySvgUrl(parts.key, { height: 64 }), orig: iconifySvgUrl(parts.key) },
      collection: col || null,
    }
  }
  if (parts.provider === 'ambientcg') {
    const item = await ambientcgDetail(cfg, parts.key)
    if (!item) throw new Error('ambientCG 里没有 id 为「' + parts.key + '」的材质。')
    return item
  }
  if (parts.provider === 'polyhaven') {
    const item = await polyhavenDetail(cfg, parts.key)
    if (!item) throw new Error('Poly Haven 里没有 id 为「' + parts.key + '」的素材。')
    return item
  }
  throw new Error('不认识的前缀「' + parts.provider + '」。可选：liaoyunart / iconify / ambientcg / polyhaven。')
}

/** liaoyunart 的相对路径 → 绝对 URL。 */
export function liaoUrl(cfg, path) {
  const text = String(path ?? '').trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  return cfg.base.replace(/\/+$/, '') + '/' + text.replace(/^\/+/, '')
}

/** 给一条素材挑下载地址：variant=thumb/small/large/orig。 */
export function assetDownloadUrl(cfg, item, variant) {
  const wanted = ['thumb', 'small', 'large', 'orig'].includes(variant) ? variant : 'orig'
  if (item.provider === 'liaoyunart') {
    const table = { thumb: item.thumb, small: item.small, large: item.large, orig: item.orig }
    const path = table[wanted] || item.orig || item.large || item.small || item.thumb || ''
    return liaoUrl(cfg, path)
  }
  const urls = item.urls || {}
  return urls[wanted] || urls.orig || urls.thumb || ''
}

/** 文件名：<源>__<key>__<variant>.<ext>。 */
export function assetFileName(item, variant, url) {
  const key = String(item.key || item.id || 'asset').replace(/[^0-9A-Za-z._-]+/g, '-').slice(0, 80)
  let ext = ''
  try {
    ext = extname(new URL(url).pathname)
  } catch {
    ext = ''
  }
  if (!ext) ext = variant === 'orig' ? '.bin' : '.webp'
  return (String(item.provider || 'asset') + '__' + key + '__' + (variant || 'orig')).slice(0, 140) + ext
}

/** 下载一条素材到本地（缓存命中直接复用）。 */
export async function fetchAsset(cfg, item, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const variant = ['thumb', 'small', 'large', 'orig'].includes(opts.variant) ? opts.variant : 'orig'
  const url = String(opts.url || '').trim() || assetDownloadUrl(cfg, item, variant)
  if (!url) throw new Error('这条素材没有可下载的地址（' + (item.id || '') + '）。用 anim_asset_show 看有没有来源页或整包链接。')
  const dir = resolve(opts.dir || cfg.cacheDir)
  await mkdir(dir, { recursive: true })
  const target = join(dir, assetFileName(item, variant, url))
  try {
    const existing = await stat(target)
    if (existing.isFile() && existing.size > 0) return { ok: true, cached: true, path: target, bytes: existing.size, variant, url }
  } catch {
    /* not cached */
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(cfg.timeoutMs, 30000))
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error('下载失败 HTTP ' + response.status + '：' + url)
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > MAX_FETCH_BYTES) throw new Error('文件过大（' + Math.round(declared / 1048576) + 'MB），超过 80MB 上限：' + url)
    const partial = target + '.part'
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
      const info = await stat(partial)
      await rename(partial, target)
      return { ok: true, cached: false, path: target, bytes: info.size, variant, url }
    } catch (error) {
      try {
        await unlink(partial)
      } catch {
        /* ignore */
      }
      throw error
    }
  } catch (error) {
    throw new Error('下载素材失败（' + networkHint(error) + '）：' + url)
  } finally {
    clearTimeout(timer)
  }
}

function humanBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + 'GB'
  if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB'
  if (n >= 1024) return Math.round(n / 1024) + 'KB'
  return n + 'B'
}

/** 结果行：够挑、够判断授权，不淹上下文。 */
export function summarizeAsset(item, extra) {
  const idx = extra && extra.index ? extra.index + '. ' : ''
  const lines = []
  lines.push(idx + (item.id || '') + ' · ' + (item.title || '（无标题）'))
  const meta = []
  if (item.creator) meta.push(item.creator)
  if (item.category) meta.push(item.category)
  if (item.kind) meta.push(item.kind)
  if (item.tone && item.tone !== 'unknown') meta.push('色调 ' + item.tone)
  if (meta.length > 0) lines.push('   ' + meta.join(' · '))
  if (item.license) lines.push('   授权：' + item.license + '（' + licenseNote(item.license) + '）')
  if (Array.isArray(item.palette) && item.palette.length > 0) lines.push('   主色：' + item.palette.slice(0, 6).join(' '))
  if (Array.isArray(item.tags) && item.tags.length > 0) lines.push('   标签：' + item.tags.slice(0, 8).join('、'))
  if (item.urls && item.urls.thumb) lines.push('   图：' + item.urls.thumb)
  if (item.page) lines.push('   来源页：' + item.page)
  return lines.join('\n')
}

export { humanBytes }
