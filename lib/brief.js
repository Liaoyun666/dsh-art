// dsh-anim-pack / lib/brief.js
//
// 前端设计参考包：把四组数据源（341 条风格提示词、124 张镜头配方卡、
// 244 条像素特效、配色与排版经验）在一次调用里揉成一份能直接照做的 brief。
//
// 为什么要有它：模型不会为了「做前端」主动翻五个工具。给它一个入口，
// 一次拿到「定调 + 动效配方 + 可用素材 + 参数」，它才会真的用这些参考。
//
// 纯逻辑，不 import 宿主；tools/verify.mjs 直接跑。

import { clampLimit } from './catalog.js'
import { anchorsFor, palettePrototypeFor, patternsFor } from './design.js'
import { brandKit } from './type.js'

const FOLD = (text) => String(text ?? '').toLowerCase()

/** 中文虚词与套话：切 2/3 字 n-gram 时剔掉，免得「一个」「我们」命中一堆条目。 */
const STOP = new Set([
  '一个', '一种', '一些', '我们', '你们', '他们', '这是', '那是', '不是', '可以', '需要',
  '就是', '这个', '那个', '这些', '那些', '还有', '以及', '然后', '如果', '因为', '所以',
  '已经', '现在', '帮我', '给我', '做一', '做一个', '要有', '想要', '我要', '你能', '你是',
  '的话', '或者', '并且', '但是', '同时', '之后', '之前', '起来', '一下', '怎么', '什么',
  '对于', '关于', '通过', '进行', '应该', '可能', '感觉', '好像', '比较', '非常', '特别',
])

/**
 * 常见「感觉词」→ 风格库里真正会出现的词。
 * 模型说「科技感」，卡片里写的是「霓虹 / 赛博 / 光」；这一层负责搭桥。
 */
const MOTIFS = [
  { words: ['科技', '未来', '赛博', '科幻', '数码', '智能', 'cyber', 'tech'], tokens: ['科技', '霓虹', '赛博', '未来', '光'] },
  { words: ['极简', '简洁', '干净', '克制', '留白', 'minimal'], tokens: ['极简', '干净', '留白', '线'] },
  { words: ['温暖', '温柔', '治愈', '舒服', '柔和'], tokens: ['暖', '柔', '治愈', '光'] },
  { words: ['复古', '怀旧', '胶片', '老派', 'retro'], tokens: ['复古', '胶片', '颗粒'] },
  { words: ['高级', '奢华', '质感', '精致', '贵'], tokens: ['高级', '金属', '光泽', '质感'] },
  { words: ['活泼', '可爱', '有趣', '弹跳', '年轻'], tokens: ['活泼', '弹跳', '卡通', '圆'] },
  { words: ['中国风', '国风', '东方', '水墨', '古风'], tokens: ['中国风', '水墨', '东方', '墨'] },
  { words: ['暗黑', '深色', '黑夜', '低调'], tokens: ['黑', '暗', '夜'] },
  { words: ['手绘', '卡通', '绘本', '插画'], tokens: ['手绘', '卡通', '绘本', '插画'] },
  { words: ['数据', '仪表', '图表', '指标', '报表'], tokens: ['数据', '数字', '图表', '指标'] },
  { words: ['文字', '排版', '标题', '字卡', '字幕'], tokens: ['字', '文字', '排版', '标题'] },
]

/**
 * 八种常见前端 / 视觉场景。每项给出：镜头卡该翻哪几类、像素特效该翻哪几类、
 * 版式要点、默认配色倾向。surface 可以写 id，也可以写中文关键词。
 */
export const DESIGN_SURFACES = [
  {
    id: 'web-landing',
    name: '网页 / 落地页 / 官网',
    keywords: ['网页', '官网', '落地页', '首页', '专题页', '产品页', '网站', '官网首页', 'landing', 'web'],
    shots: ['opening', 'typography', 'ui-entrance', 'transition', 'effects', 'outro'],
    fx: ['ui', 'transitions'],
    fxHints: ['toast', 'button', 'cursor', 'loader', 'scroll', 'window'],
    light: true,
    layout: '首屏一句主张 + 一个主动效；往下每屏只讲一个信息点。滚动进入用「淡入 + 上移 12–24px」，不要每屏都加花活。',
  },
  {
    id: 'dashboard',
    name: '仪表盘 / 数据看板 / 后台',
    keywords: ['仪表盘', '看板', '后台', '管理台', '报表', '数据大屏', '监控', 'dashboard', 'admin'],
    shots: ['data', 'ui-entrance', 'effects', 'camera'],
    fx: ['ui', 'transitions', 'status'],
    fxHints: ['number', 'count', 'bar', 'chart'],
    light: false,
    layout: '数字用等宽/tabular-nums，字号 28–40px；卡片同高同圆角，12 列网格、间距 16 或 24；一屏最多一个数字滚动。',
  },
  {
    id: 'app',
    name: 'App / 移动端 / 小程序',
    keywords: ['app', '移动端', '手机', '小程序', '安卓', 'ios', '界面'],
    shots: ['ui-entrance', 'interaction', 'transition', 'effects'],
    fx: ['ui', 'transitions', 'status', 'pickups'],
    fxHints: ['toast', 'button', 'loader', 'pickup', 'notify'],
    light: true,
    layout: '触控热区 ≥ 44px；页面转场 200–250ms ease-out；底部 tab 图标 24px、标签 10–11px；一屏一个主操作。',
  },
  {
    id: 'game-ui',
    name: '游戏 UI / HUD / 菜单',
    keywords: ['游戏', 'hud', '菜单', '技能图标', '血条', 'game', 'ui界面'],
    shots: ['ui-entrance', 'effects', 'interaction', 'opening'],
    fx: ['ui', 'fire', 'ice', 'lightning', 'impacts', 'pickups', 'status'],
    fxHints: ['hit', 'slash', 'pickup', 'bar', 'combo', 'buff'],
    light: false,
    layout: 'HUD 用 1px 描边 + 半透明底（黑 40–60%），字号 ≥ 14px；动效 120–200ms，打击感靠位移与闪白，不靠长动画。',
  },
  {
    id: 'deck',
    name: 'PPT / 演示 / 汇报',
    keywords: ['ppt', '演示', '汇报', '提案', '幻灯片', 'slide', '路演'],
    shots: ['typography', 'transition', 'data', 'opening', 'outro'],
    fx: ['ui', 'transitions'],
    fxHints: ['reveal', 'transition', 'count'],
    light: true,
    layout: '一页一个结论；标题 28–36pt、正文 ≥ 18pt；数据页只放 1 个主图表 + 1 句解读；转场只用一种。',
  },
  {
    id: 'promo',
    name: '宣传片 / 短视频 / 片头',
    keywords: ['宣传片', '短视频', '广告', '片头', '视频', '动画片', 'promo', 'video'],
    shots: ['opening', 'camera', 'rhythm', 'effects', 'outro'],
    fx: ['transitions', 'explosions', 'weather', 'ui'],
    fxHints: ['flash', 'sweep', 'burst', 'rain'],
    light: false,
    layout: '前 3 秒必须抓人；按 120BPM 卡点（每拍 0.5s）；字幕每行 ≤ 14 字；结尾留 1 张 CTA 卡。',
  },
  {
    id: 'illustration',
    name: '插画 / 海报 / 图标 / 视觉稿',
    keywords: ['插画', '海报', '图标', '视觉稿', '封面', 'kv', 'banner', 'picture', 'illustration'],
    shots: ['typography', 'effects', 'opening'],
    fx: ['critters', 'nature', 'weather', 'ui'],
    fxHints: ['spark', 'leaf', 'snow', 'star'],
    light: true,
    layout: '先定 5 色板（底/面/主/辅/强调）再动手；主体占画面 40% 左右，留出标题区；图标统一 24px 网格与 2px 线宽。',
  },
  {
    id: 'generic',
    name: '通用（说不清场景时）',
    keywords: [],
    shots: ['opening', 'ui-entrance', 'typography', 'effects', 'transition'],
    fx: ['ui', 'transitions'],
    fxHints: ['toast', 'button', 'reveal'],
    light: true,
    layout: '先灰度排一版结构，确认层级后再加颜色和动效；一屏一个主动效。',
  },
]

const SURFACE_BY_ID = new Map(DESIGN_SURFACES.map((row) => [row.id, row]))

/** surface 支持 id / 中文名 / 关键词片段；认不出来就返回通用项。 */
export function resolveSurface(value) {
  const text = FOLD(value).trim()
  if (!text) return SURFACE_BY_ID.get('generic')
  const byId = SURFACE_BY_ID.get(text)
  if (byId) return byId
  for (const surface of DESIGN_SURFACES) {
    if (FOLD(surface.name).includes(text)) return surface
    if (surface.keywords.some((word) => text.includes(FOLD(word)))) return surface
  }
  return SURFACE_BY_ID.get('generic')
}

/**
 * 把一段人话切成检索词：英文/数字串、中文 2–3 字 n-gram、外加感觉词扩展。
 * 返回 [{token, weight}]，weight 越大越算数。
 */
export function tokensOf(...parts) {
  const text = FOLD(parts.filter((value) => typeof value === 'string' && value.trim()).join(' '))
  const weighted = new Map()
  const bump = (token, weight) => {
    if (!token) return
    weighted.set(token, Math.max(weighted.get(token) ?? 0, weight))
  }
  for (const run of text.match(/[a-z0-9]+/g) ?? []) {
    if (run.length >= 2) bump(run, 1.5)
  }
  for (const run of text.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (let size = 3; size >= 2; size -= 1) {
      for (let i = 0; i + size <= run.length; i += 1) {
        const gram = run.slice(i, i + size)
        if (STOP.has(gram)) continue
        bump(gram, size === 3 ? 1.6 : 1)
      }
    }
  }
  for (const motif of MOTIFS) {
    if (motif.words.some((word) => text.includes(FOLD(word)))) {
      for (const token of motif.tokens) bump(token, 2)
    }
  }
  return [...weighted.entries()].map(([token, weight]) => ({ token, weight }))
}

function scoreTokens(hay, tokens) {
  let score = 0
  const matched = []
  for (const { token, weight } of tokens) {
    if (hay.includes(token)) {
      score += weight
      matched.push(token)
    }
  }
  return { score, matched }
}

/** 341 条风格提示词里挑 2–3 条定调。 */
export function pickStyles(catalog, { tokens = [], limit = 3 } = {}) {
  if (!catalog?.entries?.length) return []
  const rows = catalog.entries.map((entry) => {
    const hay = FOLD([
      entry.id, entry.name, entry.series, entry.category, entry.description, entry.fit,
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ].join(' '))
    const { score, matched } = scoreTokens(hay, tokens)
    return { entry, score, matched, still: Boolean(entry.imagePath) }
  })
  rows.sort((a, b) => b.score - a.score || Number(b.still) - Number(a.still) ||
    FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  const picked = []
  for (const row of rows) {
    if (picked.length >= clampLimit(limit, 3, 10)) break
    if (row.score > 0) picked.push(row)
  }
  // 一个词都没命中（比如只说了「做个好看的页面」）时，退化成「有静帧的随机几条」。
  if (picked.length === 0) {
    for (const row of rows) {
      if (picked.length >= clampLimit(limit, 3, 10)) break
      if (row.still) picked.push(row)
    }
  }
  return picked
}

/** 124 张镜头卡里挑 3–5 条，按场景分类亲和度 + 关键词命中排序。 */
export function pickShots(catalog, { tokens = [], surface, limit = 5 } = {}) {
  if (!catalog?.entries?.length) return []
  const preferred = surface?.shots ?? []
  const rows = catalog.entries.map((entry) => {
    const hay = FOLD([
      entry.id, entry.card, entry.category, entry.categoryName, entry.title, entry.fit,
      entry.energy, ...(Array.isArray(entry.tags) ? entry.tags : []),
    ].join(' '))
    const { score, matched } = scoreTokens(hay, tokens)
    const at = preferred.indexOf(entry.category)
    const affinity = at === -1 ? 0 : 2.4 - at * 0.25
    const poster = entry.previewPath ? 0.4 : 0
    return { entry, score: score + affinity + poster, matched }
  })
  rows.sort((a, b) => b.score - a.score ||
    preferred.indexOf(a.entry.category) - preferred.indexOf(b.entry.category) ||
    FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  return rows.filter((row) => row.score > 0).slice(0, clampLimit(limit, 5, 12))
}

/** 244 条像素特效里挑 3–4 条能直接用的。 */
export function pickFx(catalog, { tokens = [], surface, limit = 4 } = {}) {
  if (!catalog?.entries?.length) return []
  const preferred = surface?.fx ?? []
  const rows = catalog.entries.map((entry) => {
    const hay = FOLD([
      entry.id, entry.name, entry.category, entry.categoryName, entry.desc,
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ].join(' '))
    const { score, matched } = scoreTokens(hay, tokens)
    const at = preferred.indexOf(entry.id.split('/')[0])
    const affinity = at === -1 ? 0 : 2 - at * 0.3
    const hinted = (surface?.fxHints ?? []).some((word) => hay.includes(FOLD(word))) ? 0.9 : 0
    const bonus = (entry.loop ? 0.3 : 0) + (entry.previewPath ? 0.3 : 0)
    return { entry, score: score + affinity + hinted + bonus, matched }
  })
  rows.sort((a, b) => b.score - a.score ||
    Number(Boolean(b.entry.loop)) - Number(Boolean(a.entry.loop)) ||
    FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  return rows.filter((row) => row.score > 0).slice(0, clampLimit(limit, 4, 8))
}

/**
 * 第八个数据源里的文字/美化配方：从 180 条里挑 2–3 条标题样式、装饰或背景。
 * 与 pickFx 的区别：fx 是 canvas 像素特效，这里是纯 CSS 的排版花样。
 */
export function pickTypes(lib, { tokens = [], limit = 3 } = {}) {
  if (!lib) return []
  const rows = []
  for (const kind of ['effects', 'motion', 'decor', 'background']) {
    for (const entry of lib[kind] ?? []) {
      const hay = FOLD([entry.id, entry.name, entry.category, entry.when, ...(Array.isArray(entry.tags) ? entry.tags : [])].join(' '))
      const { score, matched } = scoreTokens(hay, tokens)
      const bonus = kind === 'effects' ? 0.6 : kind === 'decor' ? 0.3 : 0
      rows.push({ entry, score: score + bonus, matched })
    }
  }
  rows.sort((a, b) => b.score - a.score || FOLD(a.entry.id).localeCompare(FOLD(b.entry.id)))
  const hit = rows.filter((row) => row.score > 0)
  const pool = hit.length > 0 ? hit : (lib.effects ?? []).slice(0, 6).map((entry) => ({ entry, score: 0, matched: [] }))
  const seen = new Set()
  const out = []
  for (const row of pool) {
    const key = row.entry.kind + ':' + row.entry.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
    if (out.length >= clampLimit(limit, 3, 6)) break
  }
  return out
}

/** 配色：先看用户说了什么，再按场景给默认值。 */
const PALETTES = [
  {
    match: ['科技', '未来', '赛博', '霓虹', '数码', '智能', '深色', '暗黑', 'dark', 'ai'],
    name: '冷色科技（深底 + 冷光）',
    hex: ['#0B0D10 底', '#12151A 面', '#5B8CFF 主', '#22D3EE 辅', '#E6EDF7 字'],
    note: '只让一个强调色发光：主按钮、进度、选中态；其余全灰。',
  },
  {
    match: ['温暖', '温柔', '治愈', '柔和', '暖'],
    name: '暖米白（柔光）',
    hex: ['#FBF7F0 底', '#FFFFFF 面', '#E7A15B 主', '#7A6A55 字', '#F2E4D2 辅'],
    note: '阴影用暖灰而不是纯黑，圆角 12–16px，动效慢一点（240–320ms）。',
  },
  {
    match: ['复古', '怀旧', '胶片', '老派'],
    name: '胶片复古（低饱和）',
    hex: ['#1C1A17 底', '#2A2621 面', '#D9A05B 主', '#A8B0A0 辅', '#F3ECDF 字'],
    note: '加 3–5% 颗粒与轻微色偏，别用纯白纯黑。',
  },
  {
    match: ['高级', '奢华', '质感', '精致', '金'],
    name: '黑白 + 一点金',
    hex: ['#0A0A0A 底', '#171717 面', '#E6E6E6 字', '#C9A227 强调'],
    note: '强调色面积 ≤ 5%；金属感靠渐变高光，不靠描边。',
  },
  {
    match: ['活泼', '可爱', '有趣', '年轻', '卡通风'],
    name: '明亮活泼（高饱和）',
    hex: ['#FFFDF5 底', '#FFFFFF 面', '#FF6B35 主', '#FFD23F 辅', '#1F2937 字'],
    note: '两个亮色别等面积；动效带一点回弹（cubic-bezier(.34,1.56,.64,1)）。',
  },
  {
    match: ['中国风', '国风', '东方', '水墨', '古风'],
    name: '宣纸国风',
    hex: ['#F4EFE6 底', '#FBF7EF 面', '#9C2A2A 主', '#1F3A34 辅', '#2B2B2B 字'],
    note: '留白 ≥ 40%，主色只用在标题与印章，别满屏红。',
  },
]

export function paletteFor({ surface, mood = '', palette = '', task = '' } = {}) {
  const text = FOLD([mood, palette, task].join(' '))
  for (const row of PALETTES) {
    if (row.match.some((word) => text.includes(FOLD(word)))) return row
  }
  if (surface && surface.light === false) {
    return {
      name: '中性深色（未指定时）',
      hex: ['#0B0D10 底', '#15181D 面', '#D7DEE8 字', '#5B8CFF 强调'],
      note: '先灰度排层级；只有一个强调色，面积 ≤ 10%。',
    }
  }
  return {
    name: '中性浅色（未指定时）',
    hex: ['#FFFFFF 底', '#F5F6F8 面', '#111827 字', '#2563EB 强调'],
    note: '先灰度排层级；只有一个强调色，面积 ≤ 10%。',
  }
}

/** 所有场景共用的硬指标，写进每份 brief，省得模型自己编。 */
export const MOTION_RULES = [
  '一屏 / 一页只放一个主动效，其余元素静态或只做 8–16px 位移。',
  '微交互 120–200ms、页面转场 240–400ms、片头镜头 ≤ 3s；缓动首选 ease-out。',
  '滚动驱动的动画必须能被 prefers-reduced-motion 关掉，且关掉后布局不塌。',
  '对比度：正文 ≥ 4.5:1，大字 ≥ 3:1；焦点态用 2px outline，别只靠颜色。',
]

function fmtStyle(row, index) {
  const entry = row.entry
  const lines = [
    (index + 1) + '. ' + entry.id + ' ' + entry.name + ' · ' + entry.series,
    '   ' + (entry.description || '（上游没写一句简介）'),
    '   适合：' + (entry.fit || '（未注明）'),
    '   打开：anim_show(id="' + entry.id + '")' + (row.still ? '；看静帧：anim_still("' + entry.id + '")' : '（这条只有文字参考）'),
  ]
  if (row.matched.length > 0) lines.splice(1, 0, '   命中：' + row.matched.slice(0, 5).join('、'))
  return lines.join('\n')
}

/** 卡片标题常常是一整句话，brief 里只留开头，正文让模型自己去 anim_shot_show 读。 */
function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? value.slice(0, max) + '…' : value
}

function fmtShot(row, index) {
  const entry = row.entry
  const meta = [
    entry.energy ? '能量 ' + entry.energy : '',
    entry.duration ? '时长 ' + entry.duration : '',
  ].filter(Boolean).join(' / ')
  return [
    (index + 1) + '. ' + entry.id + ' · ' + entry.categoryName + ' — ' + clip(entry.title || entry.card, 46),
    '   ' + (meta || '（参数见卡片）'),
    '   打开：anim_shot_show(id="' + entry.id + '")' +
      (entry.previewPath ? '；海报：anim_shot_preview(ids=["' + entry.id + '"])' : '（上游没配海报）'),
  ].join('\n')
}

function fmtFx(row, index) {
  const entry = row.entry
  const meta = [
    Array.isArray(entry.size) ? entry.size[0] + '×' + entry.size[1] : '',
    entry.loop ? '循环' : '单次',
    entry.duration ? entry.duration + 's' : '',
  ].filter(Boolean).join(' / ')
  return [
    (index + 1) + '. ' + entry.id + ' — ' + (entry.name || '') + '（' + meta + '）',
    '   打开：anim_fx_show(id="' + entry.id + '")' + (entry.previewPath ? '；看接触表：anim_fx_preview(id="' + entry.id + '")' : ''),
  ].join('\n')
}

/** 锚点只给一眼能照做的 token，完整卡片让模型去 anim_design_anchors 读。 */
function fmtAnchor(row, index) {
  const entry = row.entry
  return [
    (index + 1) + '. ' + entry.nameZh + ' · ' + entry.name + '（' + entry.id + '）',
    '   底：' + clip(entry.surface, 60) + '｜字：' + clip(entry.typography, 70),
    '   强调：' + clip(entry.accent, 70),
    '   签名：' + clip(entry.signature, 80),
    '   会破：' + clip((entry.breaksIf ?? []).join('、'), 80),
    '   打开：anim_design_anchors(query="' + entry.id + '")',
  ].join('\n')
}

/** 模式给「为什么 + 什么时候用 + 抄得出的 CSS 头」；完整 CSS 用 anim_design_patterns 取。 */
function fmtPattern(row, index) {
  const entry = row.entry
  const css = String(entry.css ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ')
  return (index + 1) + '. ' + entry.name + '（' + entry.id + '）：' + clip(entry.why, 70) +
    '\n   用在哪：' + clip(entry.when, 60) +
    '\n   CSS：' + clip(css, 150) +
    '\n   完整：anim_design_patterns(query="' + entry.id + '")'
}

/** 文字/美化配方：一条名字 + 什么时候用 + 怎么打开。 */
function fmtType(row, index) {
  const entry = row.entry
  return (index + 1) + '. ' + entry.name + '（' + entry.id + ' · ' + (entry.kind || 'effect') + '）— ' + clip(entry.when || entry.category || '', 64) +
    '\n   抄：anim_type_show(id="' + entry.id + '")'
}

function section(title, blocks) {
  if (blocks.length === 0) return []
  return ['', '## ' + title, '', ...blocks]
}

/**
 * 组装一份 brief。
 *
 * data = { styles, shots, fx }，任意一项可以是 null（该数据源没装好）。
 * 返回 { text, picks }：text 直接当工具输出，picks 给测试与调用方核对。
 */
export function buildDesignBrief({ task = '', surface = '', mood = '', palette = '', motion = '', limit } = {}, data = {}) {
  // 显式给的画面优先；没给或认不出来时才从任务描述里猜。
  const explicit = resolveSurface(surface)
  const scene = explicit.id !== 'generic' ? explicit : resolveSurface(task)
  const tokens = tokensOf(task, mood, palette, motion)
  const wants = clampLimit(limit, 3, 6)
  const styleRows = pickStyles(data.styles, { tokens, limit: Math.min(3, wants) })
  const shotRows = pickShots(data.shots, { tokens, surface: scene, limit: Math.max(3, Math.min(wants + 1, 6)) })
  const fxRows = pickFx(data.fx, { tokens, surface: scene, limit: Math.max(2, Math.min(wants, 4)) })
  const colors = paletteFor({ surface: scene, mood, palette, task })
  // 第六个数据源（设计工艺库）：锚点与版式模式只在装了库时才有，缺了不影响前五节。
  const design = data.design ?? null
  const anchorRows = design ? anchorsFor(design, { tokens, limit: 2 }) : []
  const patternRows = design ? patternsFor(design, { tokens, surface: scene, limit: 3 }) : []
  const proto = design ? palettePrototypeFor(design, { text: [mood, palette, task].join(' '), surface: scene }) : null
  // 第八个数据源（文字与前端美化）：标题样式 + 字体搭配；缺库时这两节整段跳过。
  const types = data.types ?? null
  const typeRows = types ? pickTypes(types, { tokens, limit: 3 }) : []
  let kit = null
  if (types) {
    try {
      kit = brandKit({ theme: [task, mood, palette].filter(Boolean).join(' ') || '通用品牌', dark: /深色|暗黑|夜色|dark/.test([task, mood, palette].join(' ')) })
    } catch {
      kit = null
    }
  }

  const head = [
    '# 前端设计参考包',
    '',
    '- 任务：' + (task || '（没写，按通用场景给）'),
    '- 场景：' + scene.name + '（surface=' + scene.id + '）' +
      (mood ? '　情绪：' + mood : '') + (motion ? '　动效要求：' + motion : ''),
    '- 用法：这是**参考**不是模板。先按下面的顺序打开 2–3 条，再动手排；参数表照抄，实现自己写。',
  ]

  const styleBlocks = styleRows.length > 0
    ? styleRows.map(fmtStyle)
    : ['（风格提示词库没索引到，跳过这一节：跑 node tools/build-catalog.mjs 生成 assets/catalog.json）']
  const shotBlocks = shotRows.length > 0
    ? shotRows.map(fmtShot)
    : ['（镜头卡索引没读到，跳过这一节：跑 node tools/build-shots.mjs，或 anim_shot_stats 看状态）']
  const fxBlocks = fxRows.length > 0
    ? fxRows.map(fmtFx)
    : ['（像素特效索引没读到，跳过这一节：跑 node tools/build-fx.mjs）']

  // 任务里出现这些词，说明要真图 / 图标 / 贴图：在 ④ 补一条外接素材库入口，⑥ 加一步。
  const assetWords = ['图标', '贴图', '纹理', '材质', '背景图', '参考图', '配图', '照片', '插画',
    '纹样', '图案', '色板', '海报', '素材', 'icon', 'texture', 'material', 'photo', 'image', 'palette', 'hdri']
  const assetHay = (task + ' ' + mood + ' ' + palette).toLowerCase()
  const wantsAsset = assetWords.some((word) => assetHay.includes(word))
  const assetLine = '- 要现成图 / 图标 / 贴图：anim_asset_search(query="…", tone="dark|light|warm|cool") —— ' +
    'liaoyunart 1.6 万条博物馆与开源参考图、iconify 20 万+ 图标、ambientCG / Poly Haven 的 CC0 材质与 HDRI；' +
    '挑定后 anim_asset_fetch(ids=["…","…"]) 一次落盘，用进交付物前 anim_asset_show 看授权。'

  const steps = []
  steps.push(styleRows[0]
    ? 'anim_show(id="' + styleRows[0].entry.id + '") — 读整条风格提示词，定基调与配色。'
    : 'anim_list_series — 先看风格库有哪些系列。')
  steps.push(shotRows[0]
    ? shotRows.slice(0, 2).map((row, i) => (i === 0 ? '' : '再 ') + 'anim_shot_show(id="' + row.entry.id + '")').join('；') + ' — 读参数表与「已知坑」。'
    : 'anim_shot_stats — 看镜头卡分类。')
  steps.push(shotRows.filter((row) => row.entry.previewPath).length > 0
    ? 'anim_shot_preview(ids=[' + shotRows.filter((row) => row.entry.previewPath).slice(0, 4).map((row) => '"' + row.entry.id + '"').join(', ') + ']) — 一次看几张海报，定镜头顺序。'
    : 'anim_shot_search(query="…") — 按关键词再找一轮。')
  steps.push(fxRows[0]
    ? 'anim_fx_show(id="' + fxRows[0].entry.id + '")，要代码就 anim_fx_export(ids=["' + fxRows[0].entry.id + '"]) 导到工作目录。'
    : 'anim_fx_stats — 看像素特效分类。')
  steps.push(anchorRows[0]
    ? 'anim_design_anchors(query="' + anchorRows[0].entry.id + '") — 读这个锚点的完整 token 与「会破的写法」，别只抄一半。'
    : 'anim_design_anchors — 看八条美学锚点怎么定调。')
  if (wantsAsset) {
    steps.push('anim_asset_search(query="…") 找真图 / 图标 / 贴图；选定用 anim_asset_fetch(ids=[…]) 批量落盘，' +
      '交付前 anim_asset_show 确认授权（© 或不明授权只当参考）。')
  }
  if (typeRows[0]) {
    steps.push('anim_type_show(id="' + typeRows[0].entry.id + '") — 抄标题 / 装饰 / 背景的 HTML + CSS（第 ⑥ 节的几条里挑一条）。')
  }
  if (kit) {
    steps.push('anim_font_css(family="' + String(kit.tokens.font.display).split(',')[0].replace(/['"]/g, '').trim() + '") — 字体引用与中文兜底栈；正文换成 ' + String(kit.tokens.font.text).split(',')[0].replace(/['"]/g, '').trim() + '。')
  }
  steps.push('anim_type_audit — 字号 / 行高 / 行长 / 对比等 15 条硬规则，交付前对照一遍。')
  steps.push('anim_design_audit — 排版前后各跑一次：15 条可用性准则 + 反 AI 味清单，3 分以上必须改。')

  const lines = [
    ...head,
    ...section('① 定调：翻这 ' + styleRows.length + ' 条风格（选 1 条当基准）', styleBlocks),
    ...section('② 动效配方：按这个顺序排（一屏一条）', shotBlocks),
    ...(anchorRows.length > 0 ? section('③ 美学锚点：整页只锁一个', anchorRows.map(fmtAnchor)) : []),
    ...section('④ 现成素材：需要画面感时用（要代码就导出）', wantsAsset ? [...fxBlocks, assetLine] : fxBlocks),
    '',
    '## ⑤ 版式与配色（照这个花，别自己另起一套）',
    '',
    '- 配色方案：' + colors.name,
    '  ' + colors.hex.join('　'),
    '  ' + colors.note,
    ...(proto ? ['- 配色变量脚手架（变量名照抄，色值换成上面那组）：' + proto.name, '  ' + proto.css] : []),
    ...(patternRows.length > 0 ? ['- 首选模式（每个都能直接抄 CSS）：', ...patternRows.map(fmtPattern)] : []),
    (palette ? '- 你给的配色：' + palette + ' —— 按 60/30/10 分配：底色 60%、面 30%、强调 10%。' : ''),
    '- 版式：' + scene.layout,
    ...MOTION_RULES.map((rule) => '- ' + rule),
    '',
    ...(typeRows.length > 0 ? section('⑥ 字体与文字样式（要现成 CSS 就从这里挑）', [
      kit ? '- 字体搭配：' + kit.pairing.name + ' —— 标题 ' + kit.tokens.font.display + '；正文 ' + kit.tokens.font.text + '（' + kit.pairing.note + '）' : '',
      '- 配字体：anim_font_css(family="…") 拿 @import / <link> 与中文兜底栈；中文标题可换 Noto Serif SC，正文 Noto Sans SC。',
      ...typeRows.map(fmtType),
    ]) : []),
    '## ⑦ 下一步（照这个顺序调，别一口气全读）',
    '',
    ...steps.map((step, i) => (i + 1) + '. ' + step),
    '',
    '参考出处：风格库 / 镜头卡（Vincentwei1021/video-shotcraft，Apache-2.0）/ 像素特效（patch-gg/pixelfx）/ 外接素材库（liaoyunart.com、Iconify、ambientCG、Poly Haven，逐条标授权）/ 文字与美化素材库（180 条配方 + 71 字体种子，字体引用 Google Fonts 与 Fontshare 的官方文件名）。镜头卡里的「上游实现」是 Remotion 文件路径，不在本插件里，只借镜头语言，不要照着路径 import。',
  ]

  const matchedTokens = [...new Set([
    ...styleRows.flatMap((row) => row.matched),
    ...shotRows.flatMap((row) => row.matched),
    ...fxRows.flatMap((row) => row.matched),
  ])]

  return {
    text: lines.filter((line) => line !== null).join('\n'),
    picks: {
      surface: scene.id,
      tokens: matchedTokens.slice(0, 12),
      styles: styleRows.map((row) => row.entry.id),
      shots: shotRows.map((row) => row.entry.id),
      fx: fxRows.map((row) => row.entry.id),
      palette: colors.name,
      anchors: anchorRows.map((row) => row.entry.id),
      patterns: patternRows.map((row) => row.entry.id),
      types: typeRows.map((row) => row.entry.id),
      fonts: kit ? [kit.tokens.font.display, kit.tokens.font.text] : [],
    },
  }
}
