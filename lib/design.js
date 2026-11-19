// dsh-anim-pack / lib/design.js
//
// 第六个数据源「设计工艺库」：把四个开源前端设计项目的可移植部分整理成数据，
// 放在 assets/design/ 下，由这里读进来做检索与拼装。
//
// - anchors.json    8 条美学锚点（Ilm-Alan/frontend-design，MIT）
// - patterns.json   24 条版式 / 卡片 / 导航 / 章节 / 文字 / 工具类 CSS 模式（web-designer-plugin，MIT）
// - heuristics.json 15 条可用性准则 + 0–4 严重度（frontend-design-audit，MIT）
// - rules.json      反 AI 味、内容纪律、工艺底线、配色原型、字体配对、动效时长（同上两个源，MIT）
//
// 数据是手工译写的（不是上游文件复制），所以运行时不联网、不依赖上游仓库。
// 纯逻辑，不 import 宿主；tools/verify.mjs 直接跑。

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { clampLimit } from './catalog.js'

const FOLD = (text) => String(text ?? '').toLowerCase()

/** 数据目录（相对插件根）。 */
export const DESIGN_DIR_REL = join('assets', 'design')

/** 四个数据文件名，缺哪个就在 missing 里记哪个。 */
export const DESIGN_FILES = ['anchors', 'patterns', 'heuristics', 'rules']

/** 模式分类：给 anim_design_patterns 的 category 用。 */
export const PATTERN_CATEGORIES = [
  { id: 'layout', name: '版式', blurb: '满幅交替、非对称栅格、错位双栏、横向滚动' },
  { id: 'card', name: '卡片', blurb: '悬停抬升、3D 倾斜、毛玻璃、商品卡底色' },
  { id: 'nav', name: '导航与按钮', blurb: '方向性下划线、文字上滑、毛玻璃导航' },
  { id: 'section', name: '章节', blurb: '整屏吸附、明暗交替、左右分屏首屏' },
  { id: 'text', name: '文字效果', blurb: '描边空心字、差值混合、遮罩上移揭示' },
  { id: 'utility', name: '工具', blurb: '隐藏滚动条、无跳动锁滚动、流式圆角、减弱动效' },
  { id: 'advanced', name: '进阶', blurb: '双色标题、宽色域强调色' },
]

/**
 * 场景 → 优先看的模式分类（顺序即优先级）。
 * surface id 与 lib/brief.js 的 DESIGN_SURFACES 对齐。
 */
export const SURFACE_PATTERN_HINTS = {
  'web-landing': ['layout', 'section', 'nav', 'text', 'advanced'],
  dashboard: ['utility', 'card', 'layout'],
  app: ['nav', 'card', 'utility'],
  'game-ui': ['text', 'card', 'utility'],
  deck: ['section', 'text', 'layout'],
  promo: ['section', 'text', 'advanced'],
  illustration: ['text', 'advanced', 'card'],
  generic: ['layout', 'card', 'section'],
}

/** 配色原型的中文触发词（rules.palettes）。 */
const PALETTE_WORDS = {
  'mono-accent': ['极简', '黑白', '克制', '单色', '编辑'],
  'warm-neutral': ['温暖', '温柔', '治愈', '柔和', '生活方式', '健康'],
  'bold-brand': ['活泼', '高饱和', '品牌', '年轻', '撞色'],
  'dark-luxury': ['暗', '深色', '黑', '科技', '奢华', '高级', 'night'],
  'sophisticated-minimal': ['干净', '简洁', '白', '专业', '企业', 'saas'],
}

function readJson(dir, name, missing) {
  try {
    return JSON.parse(readFileSync(join(dir, name + '.json'), 'utf8'))
  } catch {
    missing.push(name + '.json')
    return null
  }
}

/**
 * 读整套设计工艺库。
 *
 * 返回 { dir, anchors, patterns, heuristics, rules, missing, anchorById, patternById,
 * heuristicById, counts }。四份都读不到才抛错——少一份只是少一类参考。
 */
export function loadDesignLibrary(root, options = {}) {
  const dir = options?.dir ? resolve(options.dir) : join(root, DESIGN_DIR_REL)
  const missing = []
  const data = {}
  for (const name of DESIGN_FILES) data[name] = readJson(dir, name, missing)
  const anchors = data.anchors
  const patterns = data.patterns
  const heuristics = data.heuristics
  const rules = data.rules
  if (!anchors && !patterns && !heuristics && !rules) {
    throw new Error('cannot read design library at ' + dir)
  }
  const index = (source) => new Map((source?.entries ?? []).map((entry) => [FOLD(entry.id), entry]))
  return {
    dir,
    anchors,
    patterns,
    heuristics,
    rules,
    missing,
    anchorById: index(anchors),
    patternById: index(patterns),
    heuristicById: index(heuristics),
    counts: {
      anchors: anchors?.entries?.length ?? 0,
      patterns: patterns?.entries?.length ?? 0,
      heuristics: heuristics?.entries?.length ?? 0,
      palettes: rules?.palettes?.length ?? 0,
      typePairings: rules?.typePairings?.length ?? 0,
      antiPatterns: rules?.antiPatterns?.length ?? 0,
    },
  }
}

/** 家底：计数、分类分布、出处。anim_design_anchors 无参时也给这个。 */
export function designStats(lib) {
  const patterns = lib.patterns?.entries ?? []
  const byCategory = new Map()
  for (const entry of patterns) {
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1)
  }
  return {
    ...lib.counts,
    patternCategories: PATTERN_CATEGORIES.map((row) => ({
      id: row.id,
      name: row.name,
      count: byCategory.get(row.id) ?? 0,
    })).filter((row) => row.count > 0),
    upstream: [
      lib.anchors?.upstream?.[0]?.name,
      lib.patterns?.upstream?.[0]?.name,
      lib.heuristics?.upstream?.[0]?.name,
    ].filter(Boolean),
    missing: lib.missing,
    dir: lib.dir,
  }
}

function hayOf(entry, extra = []) {
  return FOLD([
    entry.id, entry.name, entry.nameZh, entry.category, entry.categoryName,
    entry.why, entry.when, entry.principle, entry.signature,
    ...(Array.isArray(entry.keywords) ? entry.keywords : []),
    ...(Array.isArray(entry.bestFor) ? entry.bestFor : []),
    ...(Array.isArray(entry.lookFor) ? entry.lookFor : []),
    ...extra,
  ].filter(Boolean).join(' '))
}

function scoreTokens(hay, tokens) {
  let score = 0
  const matched = []
  for (const { token, weight } of tokens) {
    if (hay.includes(FOLD(token))) {
      score += weight
      matched.push(token)
    }
  }
  return { score, matched }
}

/** 按 id / 中文名 / 关键词找一条美学锚点。 */
export function resolveAnchor(lib, value) {
  const text = FOLD(value).trim()
  if (!text) return { kind: 'missing', entry: null }
  const byId = lib.anchorById.get(text)
  if (byId) return { kind: 'exact', entry: byId }
  const entries = lib.anchors?.entries ?? []
  const loose = entries.filter((entry) =>
    FOLD(entry.name) === text || FOLD(entry.nameZh) === text ||
    FOLD(entry.nameZh).includes(text) || FOLD(entry.name).includes(text))
  if (loose.length === 1) return { kind: 'loose', entry: loose[0] }
  if (loose.length > 1) return { kind: 'ambiguous', entry: loose[0], candidates: loose }
  const hits = entries.filter((entry) =>
    (entry.keywords ?? []).some((word) => text.includes(FOLD(word)) || FOLD(word).includes(text)))
  if (hits.length === 0) return { kind: 'missing', entry: null }
  return { kind: 'loose', entry: hits[0], candidates: hits }
}

/** 按 id / 中文名 / 关键词找一条可用性准则。 */
export function resolveHeuristic(lib, value) {
  const text = FOLD(value).trim()
  if (!text) return { kind: 'missing', entry: null }
  const byId = lib.heuristicById.get(text)
  if (byId) return { kind: 'exact', entry: byId }
  const entries = lib.heuristics?.entries ?? []
  const loose = entries.filter((entry) =>
    FOLD(entry.nameZh).includes(text) || FOLD(entry.name).includes(text) || text.includes(FOLD(entry.id)))
  if (loose.length === 1) return { kind: 'loose', entry: loose[0] }
  if (loose.length > 1) return { kind: 'ambiguous', entry: loose[0], candidates: loose }
  return { kind: 'missing', entry: null }
}

/** 一张锚点卡片的完整内容。 */
export function summarizeAnchor(entry) {
  const lines = [
    '## ' + entry.nameZh + ' · ' + entry.name + '（' + entry.id + '）',
    '',
    ...(Array.isArray(entry.bestFor) && entry.bestFor.length > 0 ? ['适合：' + entry.bestFor.join('、')] : []),
    ...(Array.isArray(entry.keywords) && entry.keywords.length > 0 ? ['检索词：' + entry.keywords.join('、')] : []),
    '',
    '- 底：' + entry.surface,
    '- 字：' + entry.typography,
    '- 强调：' + entry.accent,
    '- 结构：' + entry.structure,
    '- 质感：' + entry.texture,
    '- 动效：' + entry.motion,
    '- 签名动作：' + entry.signature,
    '',
    '会破的写法（出现其中一项就不算这个锚点）：' + (entry.breaksIf ?? []).join('、'),
  ]
  return lines.join('\n')
}

/** 锚点列表（一句话版）。 */
export function summarizeAnchorList(lib) {
  const entries = lib.anchors?.entries ?? []
  return entries.map((entry) =>
    '- ' + entry.id + ' · ' + entry.nameZh + ' — ' + (entry.bestFor ?? []).slice(0, 3).join('、') +
    '｜签名：' + entry.signature,
  ).join('\n')
}

/**
 * 按检索词给锚点打分：命中关键词 / 适合场景 / 名字都算，命中 breaksIf 不会扣分，
 * 但如果任务里明确说了某个「破法」词，那一项由调用方的语义判断处理（这里不做）。
 */
export function anchorsFor(lib, { tokens = [], limit = 2 } = {}) {
  const entries = lib.anchors?.entries ?? []
  if (entries.length === 0) return []
  const rows = entries.map((entry) => {
    const { score, matched } = scoreTokens(hayOf(entry), tokens)
    return { entry, score, matched }
  })
  rows.sort((a, b) => b.score - a.score || FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  const max = clampLimit(limit, 2, 8)
  const picked = rows.filter((row) => row.score > 0).slice(0, max)
  return picked.length > 0 ? picked : rows.slice(0, max).map((row) => ({ ...row, score: 0 }))
}

/**
 * 按检索词 + 场景挑版式模式。分类亲和度只当加分，关键词命中仍然优先。
 */
export function patternsFor(lib, { tokens = [], surface, limit = 3 } = {}) {
  const entries = lib.patterns?.entries ?? []
  if (entries.length === 0) return []
  const preferred = SURFACE_PATTERN_HINTS[surface?.id] ?? SURFACE_PATTERN_HINTS.generic
  const rows = entries.map((entry) => {
    const { score, matched } = scoreTokens(hayOf(entry, [entry.css]), tokens)
    const at = preferred.indexOf(entry.category)
    const affinity = at === -1 ? 0 : 1.6 - at * 0.2
    return { entry, score: score + affinity, matched }
  })
  rows.sort((a, b) => b.score - a.score ||
    preferred.indexOf(a.entry.category) - preferred.indexOf(b.entry.category) ||
    FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  return rows.filter((row) => row.score > 0).slice(0, clampLimit(limit, 3, 8))
}

/**
 * 一个检索词命中没有：整词优先；中文长词再退一步按 2 字组合匹配。
 * 「数据看板」这类四字词在卡片里往往只写作「看板」，不退这一步就永远查不到。
 */
function termMatches(word, hay) {
  if (hay.includes(word)) return true
  if (!/[\u4e00-\u9fff]/.test(word) || word.length < 3) return false
  for (let i = 0; i + 2 <= word.length; i += 1) {
    if (hay.includes(word.slice(i, i + 2))) return true
  }
  return false
}

/**
 * 关键词 / 分类检索模式（anim_design_patterns）。每词都必须命中，和动画库一致；
 * 整词全不中时退成「命中任意词」的排序结果——返回空数组对调用方没有任何用。
 */
export function searchPatterns(lib, { query = '', category = '', limit } = {}) {
  const entries = lib.patterns?.entries ?? []
  const words = FOLD(query).split(/\s+/).filter(Boolean)
  const cat = FOLD(category).trim()
  const strict = []
  const loose = []
  for (const entry of entries) {
    if (cat && FOLD(entry.category) !== cat && FOLD(entry.categoryName) !== cat) continue
    const hay = hayOf(entry, [entry.css])
    const hits = words.filter((word) => termMatches(word, hay))
    let score = hits.length * 10
    if (words.length === 0 && cat) score = 1
    if (score === 0) score = 0.5
    const row = { entry, hits, score }
    if (words.length === 0 || hits.length === words.length) strict.push(row)
    else if (hits.length > 0) loose.push(row)
  }
  const rows = strict.length > 0 ? strict : loose
  rows.sort((a, b) => b.score - a.score || FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  return rows.slice(0, clampLimit(limit, 20, 200))
}

/** 一条模式的完整卡片。 */
export function summarizePattern(entry) {
  return [
    '## ' + entry.name + '（' + entry.id + '）',
    '',
    '- 分类：' + entry.categoryName,
    '- 为什么：' + entry.why,
    '- 什么时候用：' + entry.when,
    '',
    'CSS：',
    entry.css,
  ].join('\n')
}

/** 取配色原型：先看文字里的词，再退回「深色场景给暗色奢华 / 否则给高级极简」。 */
export function palettePrototypeFor(lib, { text = '', surface } = {}) {
  const palettes = lib.rules?.palettes ?? []
  if (palettes.length === 0) return null
  const hay = FOLD(text)
  for (const palette of palettes) {
    const words = PALETTE_WORDS[palette.id] ?? []
    if (words.some((word) => hay.includes(FOLD(word)))) return palette
  }
  const fallback = surface?.light === false ? 'dark-luxury' : 'sophisticated-minimal'
  return palettes.find((row) => row.id === fallback) ?? palettes[0]
}

/**
 * 审查清单：15 条准则 + 严重度标尺 + 反 AI 味 + 内容纪律 + 工艺底线。
 * focus 给了就只展开那一条（其余仍列标题，方便按号引用）。
 */
export function auditChecklist(lib, { focus = '' } = {}) {
  const heuristics = lib.heuristics?.entries ?? []
  const rules = lib.rules ?? {}
  const focused = focus ? resolveHeuristic(lib, focus) : { entry: null }
  const L = []
  L.push('# 前端设计审查清单')
  L.push('')
  L.push('- 用法：先按 15 条逐项过一遍，每条记一个 0–4 分；≥3 的必须改，2 分挑最便宜的改。')
  L.push('- 严重度看「用户受损程度」，不看修复难度：频率 × 影响 × 持续性三项都高才是 4。')
  const scale = lib.heuristics?.scale ?? []
  if (scale.length > 0) {
    L.push('')
    L.push('严重度：' + scale.map((row) => row.rating + ' ' + row.label).join(' / '))
  }
  for (const entry of heuristics) {
    if (focused.entry && focused.entry.id !== entry.id) {
      L.push('')
      L.push('- [' + entry.id + '] ' + entry.nameZh + '（' + entry.name + '）')
      continue
    }
    L.push('')
    L.push('## ' + entry.nameZh + ' · ' + entry.name)
    L.push('')
    L.push('原则：' + entry.principle)
    L.push('')
    L.push('代码层这样查：')
    for (const item of entry.lookFor ?? []) L.push('- ' + item)
    if (Array.isArray(entry.severity) && entry.severity.length > 0) {
      L.push('')
      L.push('打分参考：' + entry.severity.join('；'))
    }
  }
  const anti = rules.antiPatterns ?? []
  if (anti.length > 0) {
    L.push('')
    L.push('## 反 AI 味（看一眼就该改掉）')
    L.push('')
    for (const row of anti) L.push('- ' + row.trap + ' → ' + row.instead)
  }
  const discipline = rules.contentDiscipline ?? []
  if (discipline.length > 0) {
    L.push('')
    L.push('## 内容纪律')
    L.push('')
    for (const row of discipline) L.push('- ' + row)
  }
  const floor = rules.craftFloor ?? []
  if (floor.length > 0) {
    L.push('')
    L.push('## 工艺底线')
    L.push('')
    for (const row of floor) L.push('- ' + row)
  }
  return L.join('\n')
}
