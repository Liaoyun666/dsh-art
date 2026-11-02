// lib/prompt.js — 把 analyseImage() 的分析结果翻译成「可以直接拿去用」的文字。
//
// 这一层是纯函数、不联网、不调模型：输入一份 analysis，输出
//   ① 中文说明（人看的）
//   ② 英文生成提示词（图像模型 / 代码特效生成器吃的）
//   ③ 运动线索（从元素角色推出来的动作建议，喂给 pixelfx 的 act 时间轴）
//
// 设计原则：没有把握的东西不写。宁缺毋滥——提示词里出现一个猜错的形容词，
// 生成出来的东西就跑偏了，所以所有形容词都必须由分析数据直接支撑。

const KIND_ZH = {
  'framed-artwork': '装裱画作 / 照片（有留白或画框）',
  texture: '满幅纹理贴图（无背景、可直接平铺）',
  'sprite-sheet': '精灵表（纯色背景上排布着多个小图）',
  scene: '场景图（有背景 + 前景主体）',
}

const KIND_EN = {
  'framed-artwork': 'a framed reproduction of a painting',
  texture: 'a seamless tiling texture with no background',
  'sprite-sheet': 'a sprite sheet of many small sprites on a flat background',
  scene: 'an illustrated scene with a distinct background and foreground subject',
}

export const ROLE_ZH = {
  character: '主体 / 角色',
  prop: '道具 / 物件',
  text: '文字 / 标题',
  silhouette: '剪影 / 远景块面',
  accent: '高光 / 点缀',
  sprite: '单个小图',
}

const ROLE_EN = {
  character: 'main subject',
  prop: 'object',
  text: 'lettering',
  silhouette: 'background mass',
  accent: 'highlight',
  sprite: 'sprite',
}

/** 角色的默认动作建议：没有动作信息时，用它给个靠谱的起点。 */
const ROLE_MOTION = {
  character: { zh: '待机呼吸 + 一次挥手/出招', en: 'idle breathing into one swing', act: 'anticipation 25% → strike 10% → recover 65%' },
  prop: { zh: '悬停自转 + 受击碎裂', en: 'hovering spin, shatters on impact', act: 'rise 30% → hold 40% → break 30%' },
  text: { zh: '逐字浮现 + 轻微上浮', en: 'letters appearing one by one, slight rise', act: 'stagger 70% → settle 30%' },
  silhouette: { zh: '缓慢视差平移', en: 'slow parallax drift', act: 'linear loop' },
  accent: { zh: '闪烁抖动（高光呼吸）', en: 'flicker and jitter', act: '8-frame loop' },
  sprite: { zh: '单帧循环（不做动作）', en: 'single frame, no motion', act: 'static' },
}

const pct = (v) => Math.round(v * 100) + '%'

/** 把调色板里的颜色压成一行 hex（重的排前面，已由 analysis 排好）。 */
export function hexList(palette, limit = 8) {
  const rows = Array.isArray(palette) ? palette : []
  const out = []
  for (const p of rows) {
    if (!p || p.from === 'background') continue
    const hex = String(p.hex || '').toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(hex) && !out.includes(hex)) out.push(hex)
    if (out.length >= limit) break
  }
  return out
}

/** 一句话概括这张图的类型 + 主体。 */
export function describeSubject(analysis) {
  const kind = analysis?.kind ?? 'scene'
  const els = Array.isArray(analysis?.elements) ? analysis.elements : []
  const main = els.find((e) => e.role === 'character') ?? els[0] ?? null
  const bits = [KIND_ZH[kind] ?? kind]
  if (main) {
    const cn = main.meanColor?.zh ? '，主色' + main.meanColor.zh : ''
    bits.push(ROLE_ZH[main.role] + '（' + pct(main.areaShare) + ' 画面' + cn + '）')
  }
  const n = els.length
  if (n > 1) bits.push('另有 ' + (n - 1) + ' 个次要元素')
  return bits.join('；')
}

/** 构图：地平线、重心、三分法，只写测得出来的。 */
export function describeComposition(analysis) {
  const comp = analysis?.composition
  const src = analysis?.source
  if (!comp || !src) return '构图信息缺失。'
  // 贴图没有前景 / 背景，也没有地平线：乱说一句比不说更糟。
  if (analysis?.kind === 'texture') {
    return '无缝贴图：整张都是内容，没有前景 / 背景之分，可以四方连续平铺。'
  }
  const bits = []
  if (comp.horizon) bits.push('地平线在高度 ' + pct(comp.horizon.y) + ' 处（' + (comp.horizon.kind === 'sky-ground' ? '天地分界' : '画面内部边缘') + '）')
  else if (analysis.background?.frame) bits.push('没有可见地平线（装裱画面）')
  if (comp.centroid) bits.push('视觉重心在 (' + Number(comp.centroid.x).toFixed(2) + ', ' + Number(comp.centroid.y).toFixed(2) + ')')
  const thirds = Array.isArray(comp.thirdsHits) ? comp.thirdsHits : Array.isArray(comp.thirds) ? comp.thirds : []
  if (thirds.length) bits.push('有 ' + thirds.length + ' 个元素压在三分线 / 交点上')
  // 字段名是 fgShare / negativeSpace；早期写成 comp.fg / comp.neg，于是永远读到 undefined → 100% / 0%。
  const fg = Number.isFinite(comp.fgShare) ? comp.fgShare : 1 - (Number(comp.negativeSpace) || 0)
  const neg = Number.isFinite(comp.negativeSpace) ? comp.negativeSpace : Math.max(0, 1 - fg)
  bits.push('前景占 ' + pct(fg) + '，背景占 ' + pct(neg))
  return bits.join('，') + '。'
}

/** 元素表（中文表格行），给 docs / 报告用。 */
export function elementTable(analysis, limit = 12) {
  const els = Array.isArray(analysis?.elements) ? analysis.elements.slice(0, limit) : []
  const rows = ['| # | 角色 | 位置 (x,y,w,h) | 占画面 | 填充 | 主色 |', '|---|---|---|---|---|---|']
  els.forEach((e, i) => {
    const b = e.bbox
    rows.push('| ' + i + ' | ' + (ROLE_ZH[e.role] ?? e.role) + ' | ' +
      b.x + ',' + b.y + ',' + b.w + ',' + b.h + ' | ' +
      pct(e.areaShare) + ' | ' + Number(e.fill ?? 0).toFixed(2) + ' | ' +
      (e.meanColor?.zh ?? '—') + ' ' + (e.meanColor?.hex ?? '') + ' |')
  })
  return rows.join('\n')
}

/** 从角色列表推运动线索：每个角色一条，最多 4 条。 */
export function motionCues(analysis, limit = 4) {
  const els = Array.isArray(analysis?.elements) ? analysis.elements : []
  const seen = new Set()
  const out = []
  for (const e of els) {
    const key = e.role
    if (seen.has(key) || !ROLE_MOTION[key]) continue
    seen.add(key)
    out.push({
      role: e.role,
      zh: ROLE_MOTION[key].zh,
      en: ROLE_MOTION[key].en,
      act: ROLE_MOTION[key].act,
    })
    if (out.length >= limit) break
  }
  return out
}

/** 给 anim_search / anim_ref_search 用的检索词建议（中英各一套）。 */
export function suggestSearches(analysis) {
  const els = Array.isArray(analysis?.elements) ? analysis.elements : []
  const main = els.find((e) => e.role === 'character') ?? els[0] ?? null
  const zh = []
  const en = []
  const palette = hexList(analysis?.palette, 1)
  const color = main?.meanColor?.family || main?.meanColor?.zh || ''
  if (color) { zh.push(color); en.push(String(main?.meanColor?.en ?? '').split('/')[0] || '') }
  if (analysis?.kind === 'sprite-sheet') { zh.push('精灵 图标'); en.push('sprite icon') }
  else if (analysis?.kind === 'texture') { zh.push('纹理 材质'); en.push('texture') }
  else if (main) { zh.push(ROLE_MOTION[main.role]?.zh ? '人物 角色' : '特效'); en.push('character effect') }
  if (analysis?.background?.sky) zh.push('天空 场景')
  const clean = (arr) => arr.map((s) => String(s || '').trim()).filter(Boolean)
  return {
    zh: clean(zh).slice(0, 3),
    en: clean(en).slice(0, 3),
    palette,
  }
}

/** 英文生成提示词：正面描述 + 约束，逗号分句，方便直接粘贴。 */
export function buildImagePrompt(analysis, opts = {}) {
  const kind = analysis?.kind ?? 'scene'
  const els = Array.isArray(analysis?.elements) ? analysis.elements : []
  const main = els.find((e) => e.role === 'character') ?? els[0] ?? null
  const hexes = hexList(analysis?.palette, opts.colors ?? 8)
  const parts = []
  parts.push(opts.subject ? String(opts.subject) : KIND_EN[kind] ?? 'a scene')
  if (main) {
    const shape = main.bbox.w > main.bbox.h * 1.4 ? 'wide' : main.bbox.h > main.bbox.w * 1.4 ? 'tall' : 'compact'
    parts.push('one ' + (ROLE_EN[main.role] ?? 'subject') + ' in a ' + shape + ' silhouette, ' +
      (main.meanColor?.en ? 'mainly ' + String(main.meanColor.en).split('/')[0] : 'solid colour'))
  }
  if (hexes.length) parts.push('palette ' + hexes.join(' '))
  const comp = analysis?.composition
  if (comp?.horizon) parts.push('horizon line at ' + pct(comp.horizon.y) + ' height')
  if (analysis?.kind === 'sprite-sheet') parts.push((analysis.sheet?.count ?? 4) + ' sprites on a flat background, even spacing')
  if (analysis?.kind === 'texture') parts.push('seamless tiling, no background, no border')
  // 源图本身是像素画就直说「pixel art」；否则说「rendered as」，免得把照片说成像素画。
  parts.push((analysis?.art?.isPixelArt ? 'pixel art' : 'rendered as small pixel art') +
    ', hard edges, no anti-aliasing, limited palette, ' + (opts.size ? opts.size + ' canvas' : 'small canvas'))
  return parts.join(', ')
}

/** 代码特效提示词（喂给 pixelfx 生成器 / 让模型自己写特效时当规范）。 */
export function buildFxPrompt(analysis, opts = {}) {
  const els = Array.isArray(analysis?.elements) ? analysis.elements : []
  const main = els.find((e) => e.role === 'character') ?? els[0] ?? null
  const hexes = hexList(analysis?.palette, 6)
  const cues = motionCues(analysis, 2)
  const lines = []
  lines.push('effect: ' + (opts.name || (main ? ROLE_EN[main.role] + '-based effect' : 'code effect')))
  const long = opts.size
    ? Number(opts.size)
    : main ? Math.min(96, Math.max(32, round16(Math.max(main.bbox.w, main.bbox.h) / 2))) : 64
  const short = main ? Math.max(16, round16(long * (Math.min(main.bbox.w, main.bbox.h) / Math.max(main.bbox.w, main.bbox.h)))) : long
  const aspect = main && main.bbox.w > main.bbox.h ? long : short
  const canvasH = main && main.bbox.w > main.bbox.h ? short : long
  lines.push('canvas: ' + aspect + 'x' + canvasH)
  if (hexes.length) lines.push('palette: ' + hexes.join(', '))
  if (main) lines.push('silhouette: ' + (main.bbox.w > main.bbox.h ? 'wide' : 'tall') + ', fill ' + Number(main.fill ?? 0).toFixed(2))
  for (const c of cues) lines.push('motion: ' + c.en + ' (' + c.act + ')')
  lines.push('render: emit particles on the code clock, two buffers (current/previous), no engine dependency')
  return lines.join('\n')
}

function round16(v) { return Math.max(16, Math.round(v / 16) * 16) }

/** 一次性打包：中文摘要 + 英文提示词 + 动作线索 + 检索建议。 */
export function buildBrief(analysis, opts = {}) {
  const palette = Array.isArray(analysis?.palette) ? analysis.palette : []
  return {
    subject: describeSubject(analysis),
    kind: analysis?.kind ?? 'scene',
    composition: describeComposition(analysis),
    palette: palette.slice(0, 12).map((p) => ({ hex: p.hex, zh: p.zh, share: p.share, from: p.from })),
    elements: (analysis?.elements ?? []).slice(0, opts.top ?? 8).map((e) => ({
      role: e.role,
      bbox: e.bbox,
      areaShare: e.areaShare,
      color: e.meanColor?.hex ?? null,
      colorZh: e.meanColor?.zh ?? null,
    })),
    motion: motionCues(analysis),
    searches: suggestSearches(analysis),
    imagePrompt: buildImagePrompt(analysis, opts),
    fxPrompt: buildFxPrompt(analysis, opts),
  }
}
