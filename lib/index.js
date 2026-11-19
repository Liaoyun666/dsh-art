// dsh-anim-pack — the 341-style code-animation prompt library as DSH tools.
//
// The library (341 Markdown prompts, 193 reference stills, a catalog and the
// original license notes) ships inside this package under assets/library/.
// The tools let a session search it, read one prompt, look at its still, and
// copy a style into a working directory — without loading 341 files into the
// context.
//
// The second dataset is a mirror of patch-gg/pixelfx (244 code-driven pixel
// effects) at <workspace>/pixelfx, indexed into assets/fx/ by
// tools/build-fx.mjs; lib/fx.js is the pure logic over that snapshot.
//
// Like the other workspace plugins this file imports no @deepseek-ai/*
// package: it is loaded from a workspace path (junction-linked into the
// profile), so only node: builtins and relative files resolve. The tool
// registration shim below stands in for @deepseek-ai/dsh-tools' defineTool.

import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, extname, join, resolve } from 'node:path'

import {
  exportEntry,
  getEntry,
  loadCatalog,
  randomEntry,
  readPrompt,
  searchEntries,
  stillPath,
  summarize,
} from './catalog.js'

import {
  downloadRef,
  humanBytes,
  normalizeRefConfig,
  randomRefs,
  refItem,
  refStats,
  searchRefs,
} from './refs.js'

import {
  exportFx,
  fxPreviewPath,
  fxSourcePath,
  fxStats,
  fxUsage,
  loadFxCatalog,
  randomFx,
  readFxSource,
  resolveFx,
  searchFx,
  summarizeFx,
} from './fx.js'

import {
  SHOTS_GALLERY,
  exportShots,
  parseShotCard,
  loadShotCatalog,
  randomShot,
  readShotCard,
  resolveShot,
  searchShots,
  shotPreviewPath,
  shotStats,
  summarizeShot,
} from './shots.js'

import { extract, safeName } from './extract.js'
import { buildDesignBrief } from './brief.js'
import { ROLE_ZH } from './prompt.js'

export const name = 'anim-pack'

export const inject = ['tools']

/** Plugin root: this file lives in <root>/lib/index.js. */
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Cap on how much prompt text one tool result prints before pointing at the file. */
const MAX_PROMPT_CHARS = 12000

/** Cap on how much effect source code anim_fx_show prints in one go. */
const MAX_FX_SOURCE = 8000

/** Markdown code fence, kept out of string literals so editors stay calm. */
const FENCE = String.fromCharCode(96, 96, 96)

/** Local stand-in for defineTool: compiles the compact parameter spec into JSON Schema. */
function defineTool(options) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(options.parameters ?? {})) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired === true) required.push(key)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
    output: { schema: options.output.schema, render: options.output.render },
    execute: options.execute,
  }
}

/** Every tool answers with text; this is the shared renderer. */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

function normalizeConfig(config) {
  const input = config !== null && typeof config === 'object' ? config : {}
  return {
    libraryPath: typeof input.libraryPath === 'string' && input.libraryPath.trim() ? input.libraryPath.trim() : '',
    exportDir: typeof input.exportDir === 'string' ? input.exportDir.trim() : '',
    // 第二个数据源（自建美术素材库）的连接参数：refBase / refCacheDir / refTimeoutMs。
    refs: normalizeRefConfig(input),
    // 第三个数据源（镜像进来的 patch-gg/pixelfx 特效仓库）：fxPath / fxExportDir。
    fxPath: typeof input.fxPath === 'string' ? input.fxPath.trim() : '',
    fxExportDir: typeof input.fxExportDir === 'string' ? input.fxExportDir.trim() : '',
    // 第五个数据源（video-shotcraft 的镜头配方卡）：shotsPath / shotsExportDir。
    shotsPath: typeof input.shotsPath === 'string' ? input.shotsPath.trim() : '',
    shotsExportDir: typeof input.shotsExportDir === 'string' ? input.shotsExportDir.trim() : '',
  }
}

/** Render one style the way anim_show / anim_random answer. */
function renderStyle(catalog, entry) {
  const still = stillPath(entry)
  const lines = [
    `# ${entry.id} ${entry.name}`,
    '',
    `- 系列：${entry.series}${entry.category ? ` / ${entry.category}` : ''}`,
    `- 适合：${entry.fit || '（未注明）'}`,
    `- 描述：${entry.description || '（未注明）'}`,
    `- 标签：${entry.tags.length > 0 ? entry.tags.join('、') : '（无）'}`,
    `- 提示词文件：${entry.filePath}`,
    `- 参考静帧：${still || '无（文字参考，148/341 条没有静帧）'}`,
    '',
  ]
  let prompt = ''
  try {
    prompt = readPrompt(entry)
  } catch (error) {
    lines.push(`（读取提示词失败：${error?.message ?? error}）`)
    return lines.join('\n')
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    lines.push(prompt.slice(0, MAX_PROMPT_CHARS))
    lines.push('', `…（已截断，完整内容见上面的提示词文件，共 ${prompt.length} 字符）`)
  } else {
    lines.push(prompt)
  }
  return lines.join('\n')
}

/** 百分比格式化：0.7854 → '78.5%'。 */
function pctOf(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return (n * 100).toFixed(n < 0.001 ? 2 : 1) + '%'
}

/** anim_extract 的答复卡片：关键数字与两段提示词直接摆出来，细节留在 report.md。 */
function renderExtractCard(result) {
  const b = result.brief ?? {}
  const art = result.art ?? {}
  const bg = result.background ?? {}
  const KIND_NOTE = {
    scene: '照片 / 场景',
    'framed-artwork': '装裱过的画',
    texture: '贴图 / 无缝材质',
    'sprite-sheet': '精灵表',
  }
  const L = []
  L.push('# ' + basename(result.file) + ' → ' + result.outDir)
  L.push('')
  L.push('- 尺寸：' + result.source.width + ' × ' + result.source.height + ' px（分析用 ' + result.analysis.width + ' × ' + result.analysis.height + ' px）')
  L.push('- 类型：**' + result.kind + '**（' + (KIND_NOTE[result.kind] ?? '未分类') + '）' +
    (art.isPixelArt && result.scale !== 1 ? '；像素画，块倍率 ×' + Math.round(1 / result.scale) + '，' + art.uniqueColors + ' 色' : ''))
  L.push('- 背景：' + pctOf(bg.share) + (bg.transparent ? '（带透明通道）' : bg.color ? ' ' + bg.color : ''))
  if (Array.isArray(b.palette) && b.palette.length > 0) {
    L.push('- 调色板：' + b.palette.map((p) => p.hex + ' ' + p.zh + (p.from === 'background' ? '（背景）' : '')).join(' · '))
  }
  if (b.composition) L.push('- 构图：' + b.composition)
  if (b.subject) L.push('- 一句话：' + b.subject)
  const els = Array.isArray(result.elements) ? result.elements : []
  if (result.kind === 'texture' && els.length > 0) {
    L.push('')
    L.push('> 无缝贴图没有可分离的前景物体：下面这些「元素」只是同一张贴图被切成几块同色区域，'
      .concat('当配色参考看就行，别当物体清单。'))
  } else if (els.length > 0) {
    L.push('')
    L.push('## 元素（共 ' + els.length + ' 个，★ = 焦点）')
    L.push('')
    L.push('| # | 角色 | 位置 x,y,w,h | 占画面 | 主色 |')
    L.push('|---|---|---|---|---|')
    for (const e of els.slice(0, 12)) {
      const bb = e.bbox ?? {}
      L.push('| ' + e.index + (e.focal ? ' ★' : '') + ' | ' + (ROLE_ZH[e.role] ?? e.role) + ' | ' +
        bb.x + ',' + bb.y + ',' + bb.w + ',' + bb.h + ' | ' +
        pctOf(e.areaShare) + ' | ' + (e.colorZh ?? '—') + (e.color ? ' ' + e.color : '') + ' |')
    }
  }
  const motion = Array.isArray(b.motion) ? b.motion : []
  if (motion.length > 0) {
    L.push('')
    L.push('## 运动线索')
    L.push('')
    for (const m of motion) L.push('- ' + (m.zh ?? m.role) + '（' + (m.en ?? '') + '）：' + (m.act ?? ''))
  }
  if (b.imagePrompt) {
    L.push('')
    L.push('## 生图提示词（imagePrompt）')
    L.push('')
    L.push(FENCE + 'text')
    L.push(b.imagePrompt)
    L.push(FENCE)
  }
  if (b.fxPrompt) {
    L.push('')
    L.push('## 像素特效提示词（fxPrompt）')
    L.push('')
    L.push(FENCE + 'text')
    L.push(b.fxPrompt)
    L.push(FENCE)
  }
  L.push('')
  L.push('## 落盘文件（' + result.outDir + '）')
  L.push('')
  const crops = Array.isArray(result.crops) ? result.crops : []
  if (crops.length > 0) {
    L.push('- crops/：' + crops.length + ' 个元素块 —— ' + crops.map((c) => c.index + '-' + c.role).join('、'))
  }
  for (const f of Array.isArray(result.files) ? result.files : []) L.push('- ' + f)
  const searches = b.searches ?? null
  if (searches) {
    const zh = Array.isArray(searches.zh) ? searches.zh.join(' ') : String(searches.zh ?? '')
    const en = Array.isArray(searches.en) ? searches.en.join(' ') : String(searches.en ?? '')
    L.push('')
    L.push('## 接着可以做什么')
    L.push('')
    if (zh) L.push('- 找同类风格：anim_search query=' + JSON.stringify(zh))
    if (en) L.push('- 找参考图：anim_ref_search query=' + JSON.stringify(en))
    L.push('- 做像素特效：anim_fx_search 挑最接近的现成特效，anim_fx_export 导出源码当骨架')
    L.push('- 想换参数重跑：anim_extract 传同一个 path，加 top / cropSize 调整')
  }
  return L.join('\n')
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const libraryRoot = config.libraryPath ? resolve(config.libraryPath) : ROOT
  const logger = ctx.logger
  /** Host logging is optional: a headless profile may not provide ctx.logger. */
  const log = (message) => {
    try {
      ;(logger?.info ?? logger?.debug)?.call(logger, message)
    } catch {
      /* logging must never break a tool call */
    }
  }

  let catalog = null
  /** Load the catalog once, on first use: a broken library must not break plugin start. */
  function getCatalog() {
    if (catalog) return catalog
    catalog = loadCatalog(libraryRoot)
    log(`anim-pack: ${catalog.total} styles (${catalog.withStill} with stills) from ${catalog.catalogPath}`)
    return catalog
  }

  /** Resolve an export directory: explicit arg, config default, else <cwd>/anim-styles. */
  function resolveExportDir(args, exec) {
    const explicit = typeof args?.dir === 'string' ? args.dir.trim() : ''
    if (explicit) return resolve(explicit)
    if (config.exportDir) return resolve(config.exportDir)
    const cwd = exec?.agent?.session?.cwd ?? process.cwd()
    return join(cwd, 'anim-styles')
  }

  // ── 入口工具：前端设计参考包 ───────────────────────────────────────────
  // 上面五组工具各自只管一个数据源；模型做视觉设计时不会主动一个个翻。
  // anim_design_brief 按「要做什么」一次跨库检索，给出定调 / 动效顺序 / 素材 /
  // 配色版式，以及「先读哪几条」的调用顺序——它是这套插件的推荐入口。
  ctx.tools.register(defineTool({
    name: 'anim_design_brief',
    description: '做视觉设计先调这个：前端 / 网页 / 落地页 / 仪表盘 / App 界面 / 游戏 HUD / PPT / 海报开工前，一次拿到参考包——按场景挑 2–3 条风格提示词、3–5 张镜头配方卡（动效顺序）、3 条现成像素特效，外加配色与版式硬指标，并给出下一步该读哪几条。跨 341 风格 + 124 镜头卡 + 244 特效检索，不用自己一个个翻。',
    parameters: {
      task: { type: 'string', required: true, description: '要做什么，一句话说清页面/产品类型和想要的感觉，例如「深色科技风的 AI 写作工具落地页，首屏要有开场动画」。检索词从这句话里抽。' },
      surface: { type: 'string', description: '画面类型（可选）：web-landing 网页/落地页、dashboard 仪表盘/后台、app 移动端、game-ui 游戏 HUD、deck PPT/演示、promo 宣传片、illustration 插画/海报；也认中文。不写就从 task 里猜。' },
      mood: { type: 'string', description: '情绪与调性，例如「极简科技」「温暖治愈」「复古胶片」。' },
      palette: { type: 'string', description: '配色要求，例如「深色 + 霓虹」「宣纸国风」。' },
      motion: { type: 'string', description: '动效要求，例如「克制，只做淡入」「卡点闪切」。' },
      limit: { type: 'number', description: '每类给几条，默认风格 3 / 镜头 4 / 特效 3，范围 1–6。' },
    },
    output: textOutput,
    async execute(args) {
      const safe = (load) => {
        try {
          return load()
        } catch {
          return null
        }
      }
      const data = {
        styles: safe(getCatalog),
        shots: safe(getShotCatalog),
        fx: safe(getFxCatalog),
      }
      if (!data.styles && !data.shots && !data.fx) {
        return [
          '三套索引都没读到，先修索引：',
          '    node tools/build-catalog.mjs   # 341 条风格提示词',
          '    node tools/build-shots.mjs     # 124 张镜头卡',
          '    node tools/build-fx.mjs        # 244 条像素特效',
          '',
          '（在插件目录里跑；缺卡片/镜像时看 anim_guide / anim_shot_guide / anim_fx_guide。）',
        ].join('\n')
      }
      return buildDesignBrief({
        task: textOf(args?.task),
        surface: textOf(args?.surface),
        mood: textOf(args?.mood),
        palette: textOf(args?.palette),
        motion: textOf(args?.motion),
        limit: args?.limit,
      }, data).text
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_list_series',
    description: '做插画 / 海报 / 前端视觉 / PPT 定调时，先看风格库有哪些系列：10 个系列与条目数（341 条提示词，193 条带参考静帧）。',
    parameters: {},
    output: textOutput,
    async execute() {
      const data = getCatalog()
      return JSON.stringify({
        total: data.total,
        withStill: data.withStill,
        series: data.series.map((row) => ({ ...row })),
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_search',
    description: '做前端视觉、海报、PPT、插画定调时，按关键词 / 系列检索 341 条代码动画风格提示词。多个词用空格分隔表示"同时命中"；不传 query 则按系列列出。返回编号、名称、适用内容、标签与是否有静帧；再用 anim_show 读完整提示词。',
    parameters: {
      query: { type: 'string', description: '关键词，例如「水墨」「粒子」「霓虹 雨夜」；也可以直接填编号（B3）或风格名。' },
      series: { type: 'string', description: '限定系列：AG / M / K / Z / H / L / V / X / R / O。' },
      limit: { type: 'number', description: '最多返回多少条，默认 20，上限 200。' },
    },
    output: textOutput,
    async execute(args) {
      const data = getCatalog()
      const rows = searchEntries(data, args ?? {})
      return JSON.stringify({
        query: args?.query ?? '',
        series: args?.series ?? '',
        count: rows.length,
        results: rows.map(summarize),
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_show',
    description: '定下风格后读全文：完整提示词（Markdown 原文）、参考静帧路径与元信息，配色 / 镜头 / 排版要求都在里面。编号不区分大小写。',
    parameters: {
      id: { type: 'string', required: true, description: '风格编号，例如 B3、Z1、R1。' },
    },
    output: textOutput,
    async execute(args) {
      const entry = getEntry(getCatalog(), args?.id)
      if (!entry) return `找不到风格编号「${args?.id ?? ''}」。先用 anim_search 检索，或用 anim_list_series 看系列。`
      return renderStyle(getCatalog(), entry)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_still',
    description: '看风格长什么样：取参考静帧图片路径，可直接交给看图工具。148 条风格没有静帧，此时会说明是文字参考。',
    parameters: {
      id: { type: 'string', required: true, description: '风格编号，例如 A1、K7。' },
    },
    output: textOutput,
    async execute(args) {
      const entry = getEntry(getCatalog(), args?.id)
      if (!entry) return `找不到风格编号「${args?.id ?? ''}」。`
      const still = stillPath(entry)
      if (!still) return `${entry.id} ${entry.name}：没有参考静帧，属于文字参考条目（341 条中 193 条有图）。`
      return `${entry.id} ${entry.name} 的参考静帧：\n${still}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_export',
    description: '定稿后把风格提示词（及参考静帧）复制到工作目录直接用：默认 <当前目录>/anim-styles/<编号>_<名称>/。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, description: '要导出的风格编号列表，例如 ["B3","Z1"]。' },
      id: { type: 'string', description: '只导出一个时可直接传单个编号。' },
      dir: { type: 'string', description: '导出到指定目录（绝对路径或相对当前目录）；省略则用 <当前目录>/anim-styles/<编号>_<名称>/。' },
    },
    output: textOutput,
    async execute(args, exec) {
      const data = getCatalog()
      const ids = []
      if (Array.isArray(args?.ids)) ids.push(...args.ids)
      if (typeof args?.id === 'string' && args.id.trim()) ids.push(args.id)
      const wanted = [...new Set(ids.map((v) => String(v).trim()).filter(Boolean))]
      if (wanted.length === 0) return '没有给出要导出的编号。用 anim_search 挑一个，再传 id 或 ids。'
      const base = resolveExportDir(args, exec)
      const results = wanted.map((id) => {
        const entry = getEntry(data, id)
        if (!entry) return { id, ok: false, error: '未知的风格编号' }
        const target = args?.dir ? base : join(base, `${entry.id}_${entry.name}`)
        return exportEntry(data, entry, target)
      })
      return JSON.stringify({ exportDir: base, results }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_random',
    description: '没想清要什么风格时随机抽一个（可限定系列），直接返回完整提示词。',
    parameters: {
      series: { type: 'string', description: '限定系列：AG / M / K / Z / H / L / V / X / R / O。' },
    },
    output: textOutput,
    async execute(args) {
      const data = getCatalog()
      const entry = randomEntry(data, args ?? {})
      if (!entry) return `系列「${args?.series ?? ''}」里没有条目。用 anim_list_series 看可选系列。`
      return renderStyle(data, entry)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_guide',
    description: '动手做动画前读一次：怎么用 341 条提示词做出代码动画——选型方法、占位符填充、时间接口、渲染成 MP4 与验收清单。',
    parameters: {},
    output: textOutput,
    async execute() {
      const guidePath = join(ROOT, 'docs', 'SKILL.md')
      try {
        return readFileSync(guidePath, 'utf8')
      } catch (error) {
        return `读取指南失败：${error?.message ?? error}\n路径：${guidePath}`
      }
    },
  }))


  // ── 第二个数据源：自建美术素材库（config.refBase，只读 JSON API）───────────
  // 本地那 341 条是「怎么画」的提示词，远程这 8 千多张是「画成什么样」的参考图。
  // 两边共用一套分类/来源/配色聚类口径，所以先搜参考图定风格、再拿提示词写代码，
  // 是这个插件最顺的用法。四条工具全部只读；网络断了就给一句人话，绝不抛异常。
  const refConfig = config.refs

  // 只有"真的连不上"才说没连上；服务器回了 404/503 之类就如实转述，别让用户以为网络坏了。
  const refFail = (error) => (error && error.network ? '（美术素材库没连上，本地 341 条代码动画提示词不受影响）' : '') + String(error?.message ?? error)

  const variantOf = (value, fallback) => {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return ['thumb', 'small', 'large', 'orig'].includes(v) ? v : fallback
  }

  /** 下载一条素材的某个尺寸到本地（缓存命中直接复用），失败也返回对象、不抛。 */
  async function grab(item, variant, dir) {
    try {
      const saved = await downloadRef(refConfig, item, { variant, dir: dir ? resolve(dir) : '' })
      return { path: saved.path, bytes: saved.bytes, cached: saved.cached, variant: saved.variant }
    } catch (error) {
      return { error: String(error?.message ?? error) }
    }
  }

  /** 搜索结果里每条只留用得上的字段：够挑图、够下载、不淹上下文。 */
  function compactRef(item, saved) {
    const row = {
      id: item.id,
      title: item.title || '',
      creator: item.creator || '',
      date: item.date || '',
      category: item.category || '',
      categoryLabel: item.categoryLabel || '',
      cluster: item.cluster ?? null,
      kind: item.kind || '',
      license: item.license || '',
      source: item.source || '',
      sourceName: item.sourceName || '',
      size: item.w && item.h ? item.w + '×' + item.h : '',
      bytes: item.bytes ?? null,
      palette: Array.isArray(item.palette) ? item.palette.slice(0, 6) : [],
      page: item.page || '',
      urls: item.urls || {},
      download: item.download || '',
    }
    if (saved && saved.path) row.localPath = saved.path
    if (saved && saved.error) row.localError = saved.error
    return row
  }

  function describeRefItem(item) {
    const lines = [
      '# ' + (item.id || '') + ' · ' + (item.title || '（无标题）'),
      '',
      '- 作者：' + (item.creator || '（未注明）'),
      '- 年代：' + (item.date || '（未注明）'),
      '- 分类：' + (item.categoryLabel || item.category || '（未分类）') + (typeof item.cluster === 'number' ? ' · 配色聚类 ' + item.cluster : ''),
      '- 来源：' + (item.sourceName || item.source || '') + (item.kind ? ' · ' + item.kind : ''),
      '- 尺寸：' + (item.w && item.h ? item.w + '×' + item.h : '（未知）') + (item.bytes ? ' · ' + humanBytes(item.bytes) : ''),
      '- 授权：' + (item.license || '见来源页'),
    ]
    if (Array.isArray(item.palette) && item.palette.length > 0) lines.push('- 主色：' + item.palette.join(' '))
    if (Array.isArray(item.tags) && item.tags.length > 0) lines.push('- 标签：' + item.tags.slice(0, 12).join('、'))
    if (item.page) lines.push('- 来源页：' + item.page)
    const urls = item.urls || {}
    if (urls.thumb) lines.push('- 缩略图：' + urls.thumb)
    if (urls.small) lines.push('- 中图：' + urls.small)
    if (urls.large) lines.push('- 大图：' + urls.large)
    if (urls.orig) lines.push('- 原图：' + urls.orig)
    if (item.download) lines.push('- 下载（带人话文件名）：' + item.download)
    return lines.join('\n')
  }

  ctx.tools.register(defineTool({
    name: 'anim_ref_sources',
    description: '做前端 / 海报 / PPT 要找配色、插画、摄影参考时，先看素材库家底：8,496 张参考图、17 个来源、18 个分类、16 个配色聚类各有多少张，授权是什么。',
    parameters: {},
    output: textOutput,
    async execute() {
      let stats
      try {
        stats = await refStats(refConfig)
      } catch (error) {
        return refFail(error)
      }
      const s = stats.stats || {}
      const lines = [
        '# 美术素材库 · ' + (s.items ?? '?') + ' 张 / ' + (s.sources ?? '?') + ' 个来源 / ' + (s.categories ?? '?') + ' 个分类 / ' + (s.clusters ?? '?') + ' 个配色聚类',
        '库地址：' + refConfig.base + '（只读检索，图片可下载）',
        '',
        '## 分类（category 参数可以传 id，也可以直接传中文名）',
      ]
      for (const c of stats.categories || []) {
        lines.push('- ' + (c.label || c.id) + ' (' + c.id + ') ' + (c.count ?? 0) + ' 张' + (c.blurb ? ' —— ' + c.blurb : ''))
      }
      lines.push('', '## 来源（source 参数）')
      for (const src of stats.sources || []) {
        lines.push('- ' + (src.name || src.id) + ' (' + src.id + ') ' + (src.count ?? 0) + ' 张 · ' + (src.license || '授权见来源页'))
      }
      lines.push('', '## 配色聚类（cluster 参数，0 起）')
      for (const k of stats.clusters || []) {
        lines.push('- #' + k.id + ' ' + (k.name || '') + ' ' + (k.size ?? 0) + ' 张')
      }
      lines.push('', '下一步：anim_ref_search(query="水墨", category="绘画") 挑图；anim_ref_show(id) 看图并拿到本地路径；再配本地提示词写代码动画。')
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_ref_search',
    description: '做前端 / 海报 / PPT / 插画时找配色与视觉参考：按关键词 / 分类 / 来源 / 配色聚类检索 8,496 张参考图（中英文都认，中文自动展开同义词）。返回缩略图与原图地址；download=true 时把图落到本地并给出 localPath。',
    parameters: {
      query: { type: 'string', description: '关键词，中英文都行：水墨 / 油画 / 像素 / space / ghibli；多个词用空格分隔，表示要同时命中。也接受 cat:绘画、src:met、cluster:3 这种前缀。' },
      category: { type: 'string', description: '限定分类：id（painting、storybook）或中文名（绘画、绘本、像素、色板）。' },
      source: { type: 'string', description: '限定来源 id：met / safebooru / vanda / iconify / ambientcg / nasa / wellcome …' },
      kind: { type: 'string', description: '限定类型：image / texture / icon / palette 等。' },
      cluster: { type: 'number', description: '限定配色聚类编号（见 anim_ref_sources，0 起）。' },
      limit: { type: 'number', description: '返回多少条，默认 12，上限 60。' },
      offset: { type: 'number', description: '跳过多少条，用来翻页（返回里有 next）。' },
      download: { type: 'boolean', description: 'true 时把每条都下载到本地缓存，结果多一个 localPath（可直接交给看图工具）。默认 false，建议先看地址再挑着下。' },
      variant: { type: 'string', description: '配合 download：thumb(200px) / small(560px) / large(1400px) / orig(原图)。默认 small。' },
      dir: { type: 'string', description: '下载到哪个目录（绝对路径或相对当前目录）；省略则用插件缓存目录。' },
    },
    output: textOutput,
    async execute(args) {
      const limit = Math.min(60, Math.max(1, Number(args?.limit) || 12))
      let data
      try {
        data = await searchRefs(refConfig, {
          query: args?.query,
          category: args?.category,
          source: args?.source,
          kind: args?.kind,
          cluster: args?.cluster,
          offset: args?.offset,
          limit,
        })
      } catch (error) {
        return refFail(error)
      }
      const wantDownload = args?.download === true
      const variant = variantOf(args?.variant, 'small')
      const results = []
      for (const item of data.items || []) {
        const saved = wantDownload && results.length < 12 ? await grab(item, variant, args?.dir) : null
        results.push(compactRef(item, saved))
      }
      return JSON.stringify({
        base: refConfig.base,
        query: data.query ?? '',
        total: data.total ?? results.length,
        offset: data.offset ?? 0,
        count: results.length,
        next: data.next ?? null,
        facets: data.facets ?? {},
        hint: data.hint ?? null,
        results,
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_ref_show',
    description: '选中参考图后看细节：元信息、授权、来源页、各尺寸地址，并把图默认下载到本地给出路径（可直接用看图工具打开或当素材用）。id 来自 anim_ref_search / anim_ref_pick。',
    parameters: {
      id: { type: 'string', required: true, description: '素材 id，例如 met_102715、safebooru_1312984。' },
      download: { type: 'boolean', description: '是否下载到本地，默认 true。' },
      variant: { type: 'string', description: '下载哪个尺寸：thumb / small / large / orig。默认 small（560px，够看清风格；要当素材用传 orig）。' },
      dir: { type: 'string', description: '下载到哪个目录；省略则用插件缓存目录。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = await refItem(refConfig, args?.id)
      } catch (error) {
        return refFail(error)
      }
      const item = data.item
      const head = describeRefItem(item)
      const parts = [head]
      if (args?.download !== false) {
        const variant = variantOf(args?.variant, 'small')
        const saved = await grab(item, variant, args?.dir)
        parts.push('')
        if (saved.path) {
          parts.push('- 本地文件（' + (saved.variant || variant) + (saved.cached ? '，缓存命中' : '') + '）：' + saved.path)
          parts.push('  可以直接交给看图工具打开，或复制进项目当素材。')
        } else {
          parts.push('- 本地下载失败：' + (saved.error || '未知原因'))
        }
      }
      const similar = Array.isArray(item.similar) ? item.similar : []
      if (similar.length > 0) {
        parts.push('', '同分类的其他 ' + similar.length + ' 张（anim_ref_show 可继续看）：')
        for (const row of similar) parts.push('- ' + row.id + ' · ' + (row.title || '（无标题）') + (row.categoryLabel ? ' · ' + row.categoryLabel : ''))
      }
      return parts.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_ref_pick',
    description: '没想清参考图要什么时，随机抽几张（可按分类 / 来源 / 聚类限定），默认下载到本地 —— 找灵感、看整体调性、拿现成素材。',
    parameters: {
      category: { type: 'string', description: '限定分类：id 或中文名。' },
      source: { type: 'string', description: '限定来源 id。' },
      kind: { type: 'string', description: '限定类型：image / texture / icon / palette。' },
      cluster: { type: 'number', description: '限定配色聚类编号。' },
      count: { type: 'number', description: '抽几张，默认 3，上限 12。' },
      download: { type: 'boolean', description: '是否下载到本地，默认 true。' },
      variant: { type: 'string', description: '下载尺寸，默认 small。' },
      dir: { type: 'string', description: '下载目录，省略用插件缓存目录。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = await randomRefs(refConfig, {
          category: args?.category,
          source: args?.source,
          kind: args?.kind,
          cluster: args?.cluster,
          count: args?.count,
        })
      } catch (error) {
        return refFail(error)
      }
      const wantDownload = args?.download !== false
      const variant = variantOf(args?.variant, 'small')
      const results = []
      for (const item of data.items || []) {
        const saved = wantDownload ? await grab(item, variant, args?.dir) : null
        results.push(compactRef(item, saved))
      }
      return JSON.stringify({
        base: refConfig.base,
        total: data.total ?? results.length,
        count: results.length,
        filters: data.filters ?? {},
        hint: data.hint ?? null,
        results,
      }, null, 2)
    },
  }))

  // ── 第三个数据源：镜像进来的 patch-gg/pixelfx（244 个代码驱动的像素特效）──────
  // 上面 341 条教「怎么画」，这 244 个是「画好了的代码」：两套缓冲、零依赖、每个都自带
  // 接触表预览。索引是 tools/build-fx.mjs 生成的快照，宿主不 import 特效模块。
  const fxRoot = config.fxPath ? resolve(config.fxPath) : ''
  let fxCatalog = null

  /** 索引缺失时回一句能照做的中文，而不是把栈丢给用户。 */
  function fxErrorText(error) {
    const message = String(error?.message ?? error)
    if (/cannot read effect catalog/.test(message)) {
      return [
        '特效索引还没生成（assets/fx/catalog.json 不存在或读不了）。',
        '',
        '在插件目录里跑一次：',
        '    node tools/build-fx.mjs --previews',
        '',
        '它需要一个 pixelfx 镜像，默认找：',
        '    ' + resolve(ROOT, '..', '..', 'pixelfx'),
        '没有的话先 git clone https://github.com/patch-gg/pixelfx 到那里，或用配置 fxPath 指过去。',
      ].join('\n')
    }
    return '特效工具出错了：' + message
  }

  /** 懒加载：索引坏了不能让插件启动失败。 */
  function getFxCatalog() {
    if (fxCatalog) return fxCatalog
    fxCatalog = loadFxCatalog(ROOT, fxRoot ? { repo: fxRoot } : {})
    log('anim-pack: ' + fxCatalog.total + ' effects from ' + fxCatalog.catalogPath)
    return fxCatalog
  }

  /** 导出目录：显式参数 → 配置 fxExportDir → <cwd>/pixelfx-fx。 */
  function resolveFxExportDir(args, exec) {
    const explicit = typeof args?.dir === 'string' ? args.dir.trim() : ''
    if (explicit) return resolve(explicit)
    if (config.fxExportDir) return resolve(config.fxExportDir)
    const cwd = exec?.agent?.session?.cwd ?? process.cwd()
    return join(cwd, 'pixelfx-fx')
  }

  const textOf = (value) => (typeof value === 'string' ? value.trim() : '')

  /** 一个特效的说明书：元信息 + act 时间轴 + 可调色带 + 接入代码（可选源码）。 */
  function renderFxCard(entry, { source = false } = {}) {
    const [w, h] = entry.size
    const file = fxSourcePath(entry)
    const preview = fxPreviewPath(entry)
    const lines = [
      '# ' + entry.id + ' · ' + entry.name,
      '',
      '- 分类：' + entry.category +
        (entry.categoryName && entry.categoryName !== entry.category ? '（' + entry.categoryName + '）' : ''),
      '- 尺寸：' + w + '×' + h + ' · 原点 (' + entry.origin[0] + ', ' + entry.origin[1] + ')',
      '- 时长：' + entry.duration + 's @ ' + entry.fps + 'fps · ' + (entry.loop ? '循环' : '单次（放完自己清场）'),
      '- 角色：' + (entry.actor ? '画了 24×38 小人（真骨骼 + IK 的表演）' : '无角色'),
      '- 描述：' + entry.desc,
      '- 标签：' + (entry.tags.length > 0 ? entry.tags.join('、') : '（无）'),
      '- 源码：' + (file || '（镜像里没有这个文件，重跑 tools/build-fx.mjs）'),
      '- 预览：' + (preview || '（还没渲染：node tools/build-fx.mjs --only ' + entry.id + ' --previews）'),
    ]
    if (entry.libPath) lines.push('- 同分类共用：' + entry.libPath)

    const options = Object.entries(entry.options ?? {})
    if (options.length > 0) {
      lines.push('', '## 可调参数（createFx 的第二个参数）')
      for (const [key, value] of options) {
        if (Array.isArray(value)) {
          const ramp = value.length + ' 档色带：' + value.slice(0, 3).join(' ') + ' … ' + value[value.length - 1]
          lines.push('- ' + key + '：' + ramp)
        } else {
          lines.push('- ' + key + '：' + String(value))
        }
      }
    }

    const act = entry.act
    if (act) {
      lines.push('', '## 表演（act：12fps 姿态关键帧 + 打击点）')
      lines.push(
        '- 蓄力 ' + act.windup + 's · ' + act.poses + ' 个姿态关键帧' +
        (act.target && typeof act.target.x === 'number' ? ' · 目标桩在 x=' + act.target.x : ''),
      )
      for (const hit of act.hits ?? []) {
        const bits = ['t=' + hit.t + 's']
        if (hit.freeze) bits.push('顿帧 ' + hit.freeze + 's')
        if (hit.shake) bits.push('震屏 ' + hit.shake)
        if (hit.push) bits.push('击退 ' + hit.push)
        if (hit.skin) bits.push('换皮 ' + hit.skin)
        lines.push('- ' + bits.join(' · '))
      }
    }

    lines.push('', '## 接入代码（浏览器 / canvas / 任意 JS 引擎）', '', '```js', fxUsage(entry), FENCE)
    lines.push('', '精灵表（Godot / Unity / GameMaker 走这条路）：在导出目录里跑')
    lines.push('    node tools/render.mjs ' + entry.id + ' --sheet')

    if (source) {
      lines.push('', '## 源码')
      try {
        const text = readFxSource(entry)
        if (text.length > MAX_FX_SOURCE) {
          lines.push(FENCE + 'js', text.slice(0, MAX_FX_SOURCE), FENCE)
          lines.push('', '…（已截断，完整 ' + text.length + ' 字符，见上面的源码路径）')
        } else {
          lines.push(FENCE + 'js', text, FENCE)
        }
      } catch (error) {
        lines.push('（读源码失败：' + String(error?.message ?? error) + '）')
      }
    }
    return lines.join('\n')
  }

  ctx.tools.register(defineTool({
    name: 'anim_fx_stats',
    description: '游戏 UI / 前端微交互要现成动效时先看家底：244 个代码驱动的像素特效、21 个分类各多少个、多少带角色表演 / 循环 / 预览图，以及上游提交与许可。',
    parameters: {},
    output: textOutput,
    async execute() {
      let data
      try {
        data = getFxCatalog()
      } catch (error) {
        return fxErrorText(error)
      }
      const stats = fxStats(data)
      return JSON.stringify({
        ...stats,
        catalogPath: data.catalogPath,
        hint: '下一步：anim_fx_search(query="冰") 找具体特效；anim_fx_preview(id) 看接触表；anim_fx_show(id) 读说明书；anim_fx_guide 看完整用法。',
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_fx_search',
    description: '前端微交互 / 游戏 UI / 状态反馈 / 粒子要现成特效代码时，按关键词 / 分类 / 循环 / 角色检索 244 个 pixelfx 特效（fire、ice、爆炸、界面、天气……）。多个词用空格分隔表示"同时命中"；再用 anim_fx_show 看细节、anim_fx_preview 看图。',
    parameters: {
      query: { type: 'string', description: '关键词，例如「冰」「爆炸」「界面」；也可以直接填 id（fire/torch）或名字。' },
      category: { type: 'string', description: '限定分类：moves / fire / explosions / water / ice / lightning / scifi / melee / impacts / projectiles / spawn / arcane / holy / shadow / status / nature / weather / ui / pickups / transitions / critters。' },
      loop: { type: 'string', description: 'loop（循环）或 once（单次）。' },
      actor: { type: 'boolean', description: 'true 只要带角色表演的，false 只要纯特效。' },
      limit: { type: 'number', description: '最多返回多少条，默认 20，上限 200。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getFxCatalog()
      } catch (error) {
        return fxErrorText(error)
      }
      const rows = searchFx(data, {
        query: textOf(args?.query),
        category: textOf(args?.category),
        loop: textOf(args?.loop),
        actor: typeof args?.actor === 'boolean' ? args.actor : null,
        limit: args?.limit,
      })
      return JSON.stringify({
        query: textOf(args?.query),
        category: textOf(args?.category),
        count: rows.length,
        total: data.total,
        results: rows.map(summarizeFx),
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_fx_show',
    description: '读一个特效的完整说明再决定用不用：尺寸 / 时长 / 是否循环、可调色带、act 表演时间轴（蓄力与每个打击点）、现成接入代码与源码路径，source=true 再附源码。id 形如 fire/torch。',
    parameters: {
      id: { type: 'string', required: true, description: '特效 id，例如 fire/torch、ice/frost-nova；也可以只写名字（torch）。' },
      source: { type: 'boolean', description: 'true 时附上特效源码（默认不附，免得一次塞太多）。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getFxCatalog()
      } catch (error) {
        return fxErrorText(error)
      }
      const found = resolveFx(data, args?.id)
      if (found.kind === 'ambiguous') {
        return '「' + String(args?.id ?? '') + '」对上了多个特效，用完整 id 指定一个：\n' +
          found.candidates.map((row) => '- ' + row.id).join('\n')
      }
      if (!found.entry) {
        return '找不到特效「' + String(args?.id ?? '') + '」。用 anim_fx_search 按关键词或分类找，anim_fx_stats 看有哪些分类。'
      }
      return renderFxCard(found.entry, { source: args?.source === true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_fx_preview',
    description: '挑特效前先看画面：给接触表（多帧拼图）的本地 PNG 路径，可直接交给看图工具；一次最多 12 个。',
    parameters: {
      id: { type: 'string', description: '一个特效 id，例如 critters/slime。' },
      ids: { type: 'array', items: { type: 'string' }, description: '一次要多个：["fire/torch","ice/frost-nova"]，最多 12 个。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getFxCatalog()
      } catch (error) {
        return fxErrorText(error)
      }
      const asked = []
      if (Array.isArray(args?.ids)) asked.push(...args.ids)
      if (typeof args?.id === 'string' && args.id.trim()) asked.push(args.id)
      const wanted = [...new Set(asked.map((v) => String(v).trim()).filter(Boolean))].slice(0, 12)
      if (wanted.length === 0) return '给一个 id（例如 fire/torch），或用 ids 一次给多个（最多 12 个）。'
      const lines = []
      for (const value of wanted) {
        const found = resolveFx(data, value)
        if (!found.entry) {
          lines.push('- ' + value + '：找不到（用 anim_fx_search 检索）')
          continue
        }
        const preview = fxPreviewPath(found.entry)
        lines.push('- ' + found.entry.id + ' ' + found.entry.name + '：' +
          (preview || '（还没有预览图，跑 node tools/build-fx.mjs --previews）'))
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_fx_export',
    description: '要把特效代码搬进项目时：把选中特效连同运行时（src/core、渲染工具、许可文件）复制成一个能直接跑的小项目；不需要 npm install。拒绝写进镜像目录和插件目录。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, description: '要导出的特效 id 列表，例如 ["fire/torch","ice/frost-nova"]。' },
      id: { type: 'string', description: '只导出一个时可直接传 id。' },
      category: { type: 'string', description: '不写 ids 时，按分类批量导出（例如 fire）。' },
      loop: { type: 'string', description: '配合 category：只导出 loop（循环）或 once（单次）的。' },
      actor: { type: 'boolean', description: '配合 category：true 只要带角色的，false 只要纯特效。' },
      limit: { type: 'number', description: '按分类批量导出时最多多少个，默认 24。' },
      runtime: { type: 'boolean', description: '是否连同 src/core 与渲染工具一起复制，默认 true。' },
      dir: { type: 'string', description: '导出到哪个目录（绝对路径或相对当前目录）；省略则用配置 fxExportDir，再否则 <当前目录>/pixelfx-fx。' },
    },
    output: textOutput,
    async execute(args, exec) {
      let data
      try {
        data = getFxCatalog()
      } catch (error) {
        return fxErrorText(error)
      }
      const wanted = []
      const pushId = (value) => {
        const text = String(value ?? '').trim()
        if (text) wanted.push(text)
      }
      if (Array.isArray(args?.ids)) args.ids.forEach(pushId)
      pushId(args?.id)

      const entries = []
      const unknown = []
      for (const value of [...new Set(wanted)]) {
        const found = resolveFx(data, value)
        if (found.entry) entries.push(found.entry)
        else unknown.push(value)
      }

      const category = textOf(args?.category)
      const loop = textOf(args?.loop)
      const filtered = Boolean(category || loop || typeof args?.actor === 'boolean')
      if (entries.length === 0 && !filtered) {
        return '没有给出要导出的特效。传 ids: ["fire/torch"]，或用 category: "fire" 批量导出。先用 anim_fx_search 挑。'
      }
      if (entries.length === 0) {
        entries.push(...searchFx(data, {
          category,
          loop,
          actor: typeof args?.actor === 'boolean' ? args.actor : null,
          limit: args?.limit,
        }))
      }
      if (entries.length === 0) return '这些条件下没有命中特效，换个分类或关键词试试。'

      const dir = resolveFxExportDir(args, exec)
      const result = exportFx(data, entries, { dir, runtime: args?.runtime !== false })
      if (result.error) return '导出失败：' + result.error
      const done = result.ids.filter((row) => row.ok)
      const sample = done[0]?.id ?? entries[0].id
      return JSON.stringify({
        exportDir: result.dir,
        ok: result.ok,
        count: done.length,
        unknown,
        effects: result.ids.map((row) => ({
          id: row.id,
          ok: row.ok,
          ...(row.file ? { file: row.file } : {}),
          ...(row.error ? { error: row.error } : {}),
        })),
        files: result.files.length,
        next: [
          'cd ' + result.dir,
          'node tools/render.mjs ' + sample + ' --zoom 2',
          'node tools/render.mjs ' + sample + ' --sheet',
        ],
        hint: '导出目录里不需要 npm install；接进引擎看 anim_fx_show 的「接入代码」，或 anim_fx_guide 第三节。',
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_fx_random',
    description: '没想清要哪个特效时随机抽一个（可限定分类 / 循环 / 角色）并给出完整说明。',
    parameters: {
      category: { type: 'string', description: '限定分类，例如 explosions、ui、weather。' },
      loop: { type: 'string', description: 'loop 或 once。' },
      actor: { type: 'boolean', description: 'true 只要带角色表演的。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getFxCatalog()
      } catch (error) {
        return fxErrorText(error)
      }
      const entry = randomFx(data, {
        category: textOf(args?.category),
        loop: textOf(args?.loop),
        actor: typeof args?.actor === 'boolean' ? args.actor : null,
      })
      if (!entry) return '这个组合下没有特效（分类名对不对？用 anim_fx_stats 看分类列表）。'
      return renderFxCard(entry)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_fx_guide',
    description: '动手前读一次：怎么用这 244 个代码特效——七条工具、挑特效到导出的流程、在游戏里接、精灵表给非 JS 引擎、自己写新特效、许可与维护。',
    parameters: {},
    output: textOutput,
    async execute() {
      const guidePath = join(ROOT, 'docs', 'fx.md')
      try {
        return readFileSync(guidePath, 'utf8')
      } catch (error) {
        return '读取特效指南失败：' + String(error?.message ?? error) + '\n路径：' + guidePath
      }
    },
  }))

  // ── 第四个数据源：你手上这一张图（元素提取）──────────────────────────────
  // 前三个数据源都是现成的（341 条提示词 / 8 千张参考图 / 244 条特效）；
  // 这一组处理「用户自己扔进来的图」：拆元素、量配色、写提示词、落盘裁剪块。
  // 纯本地 CPU，不联网；算法在 lib/{image,vision,prompt,extract}.js，
  // 工具只负责路径、参数与一句人话汇报。
  const intArg = (value, fallback, lo, hi) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(lo, Math.min(hi, Math.round(n)))
  }

  ctx.tools.register(defineTool({
    name: 'anim_extract',
    description: '有参考图要拆素材时（照片 / 插画 / 像素画 / 精灵表）：判像素画倍率与图片类型、算背景占比与天空地面地平线、逐个元素给出 bbox 与角色、裁出元素块、生成调色板与带序号的接触表，并写出可直接粘贴的生图提示词与像素特效提示词；落盘 brief.json 与中文报告 report.md。',
    parameters: {
      path: { type: 'string', required: true, description: '图片路径（PNG / JPEG / GIF / BMP / TGA；WebP、HEIC 不支持，先另存成 PNG）。绝对路径或相对当前会话目录。' },
      out: { type: 'string', description: '输出目录；省略则用 <当前目录>/anim-extract/<图片名>/。' },
      top: { type: 'number', description: '提取几个元素（按面积从大到小），默认 6，范围 1-24。' },
      max: { type: 'number', description: '分析时的最长边，默认 1024；大图等比缩小，裁剪坐标自动映射回原图。' },
      colors: { type: 'number', description: '调色板取几色，默认 12，范围 2-24。' },
      cropSize: { type: 'number', description: '每个裁剪块的目标长边像素，默认 160，范围 64-512（像素画会自动取整数倍）。' },
      crops: { type: 'boolean', description: 'false = 不裁元素块。' },
      palette: { type: 'boolean', description: 'false = 不生成 palette.png。' },
      contact: { type: 'boolean', description: 'false = 不生成 contact.png（只有一个元素时本来就不生成）。' },
    },
    output: textOutput,
    async execute(args, exec) {
      const raw = textOf(args?.path)
      if (!raw) return '要给一张图的路径，例如 C:\\art\\scene.png。支持 PNG / JPEG / GIF / BMP / TGA；WebP、HEIC 请先另存成 PNG。'
      const cwd = exec?.agent?.session?.cwd ?? process.cwd()
      const file = resolve(cwd, raw)
      try {
        if (!statSync(file).isFile()) return '这不是一个文件：' + file
      } catch {
        return '找不到这张图：' + file
      }
      const explicitOut = textOf(args?.out)
      const stem = safeName(basename(file, extname(file)) || 'image')
      const outDir = explicitOut ? resolve(cwd, explicitOut) : join(cwd, 'anim-extract', stem)
      try {
        mkdirSync(outDir, { recursive: true })
        return renderExtractCard(extract(file, {
          out: outDir,
          top: intArg(args?.top, 6, 1, 24),
          maxSide: intArg(args?.max, 1024, 256, 4096),
          colors: intArg(args?.colors, 12, 2, 24),
          cropSize: intArg(args?.cropSize, 160, 64, 512),
          crops: args?.crops !== false,
          palette: args?.palette !== false,
          contact: args?.contact !== false,
        }))
      } catch (error) {
        const message = String(error?.message ?? error)
        const hint = /webp|heic|avif/i.test(message) ? '\nWebP / HEIC 解码没做，用画图或预览另存成 PNG 再来。' : ''
        return '提取失败：' + message + '\n图片：' + file + hint
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_extract_guide',
    description: '返回「元素提取」的完整使用说明：它到底量了什么、五类图各适合怎么用、哪些结论别当真、参数怎么调、输出文件怎么接下去用。第一次用 anim_extract 前读一次。',
    parameters: {},
    output: textOutput,
    async execute() {
      const guidePath = join(ROOT, 'docs', 'extract.md')
      try {
        return readFileSync(guidePath, 'utf8')
      } catch (error) {
        return '读取提取指南失败：' + String(error?.message ?? error) + '\n路径：' + guidePath
      }
    },
  }))

  // ── 第五个数据源：video-shotcraft 的镜头配方卡（124 张 / 10 分类）──────────
  // 前四组分别是「341 条风格提示词」「8 千张参考图」「244 条像素特效」「你自己那张图」。
  // 这一组是 Vincentwei1021/video-shotcraft（Apache-2.0）的镜头卡：每张卡写清意图、
  // 动效核心、参数表、声音、已知坑，附上游 demos 里的 Remotion 实现路径。
  // 卡片与 54 张海报都随包发在 assets/shots/，索引由 tools/build-shots.mjs 生成，
  // 宿主机不联网、不 import 上游代码。
  const shotsRoot = config.shotsPath ? resolve(config.shotsPath) : ''
  let shotCatalog = null

  /** 索引缺失时给一句能照做的中文。 */
  function shotsErrorText(error) {
    const message = String(error?.message ?? error)
    if (/cannot read shot catalog/.test(message)) {
      return [
        '镜头卡索引还没生成（assets/shots/index.json 不存在或读不了）。',
        '',
        '在插件目录里跑一次：',
        '    node tools/build-shots.mjs',
        '',
        '卡片应该在 assets/shots/cards/<分类>/*.md，海报在 assets/shots/posters/*.jpg。',
        '没有卡片时从上游取：' + SHOTS_GALLERY,
      ].join('\n')
    }
    return '镜头卡工具出错了：' + message
  }

  /** 懒加载：索引坏了不影响插件启动。 */
  function getShotCatalog() {
    if (shotCatalog) return shotCatalog
    shotCatalog = loadShotCatalog(ROOT, shotsRoot ? { dir: shotsRoot } : {})
    log('anim-pack: ' + shotCatalog.cards + ' shot cards from ' + shotCatalog.catalogPath)
    return shotCatalog
  }

  /** 导出目录：显式参数 → 配置 shotsExportDir → <cwd>/shot-cards。 */
  function resolveShotExportDir(args, exec) {
    const explicit = typeof args?.dir === 'string' ? args.dir.trim() : ''
    if (explicit) return resolve(explicit)
    if (config.shotsExportDir) return resolve(config.shotsExportDir)
    const cwd = exec?.agent?.session?.cwd ?? process.cwd()
    return join(cwd, 'shot-cards')
  }

  /** 一张卡的完整说明书：frontmatter 摘要 + 卡片正文（截断到 MAX_PROMPT_CHARS）。 */
  function renderShotCard(entry) {
    const preview = shotPreviewPath(entry)
    const lines = [
      '# ' + entry.id + ' · ' + entry.title,
      '',
      '- 分类：' + entry.categoryName + '（' + entry.category + '）',
      '- 适用：' + (entry.fit || '（未注明）'),
      '- 时长：' + (entry.duration || '（未注明）'),
      '- 能量：' + (entry.energy || '（未注明）'),
      '- 标签：' + (entry.tags.length > 0 ? entry.tags.join('、') : '（无）'),
      '- 卡片：' + entry.filePath,
      '- 海报：' + (preview || '（上游没给这张卡配图，看 gallery 在线样片）'),
      '- 上游卡片：' + (entry.source || ''),
      '- 在线样片：' + (entry.galleryUrl || SHOTS_GALLERY),
    ]
    if (entry.demo) lines.push('- 上游实现：' + entry.demo + '（Remotion，在 video-shotcraft 仓库里，本插件不带）')
    lines.push('')
    let body = ''
    try {
      body = readShotCard(shotCatalog ?? getShotCatalog(), entry)
    } catch (error) {
      lines.push('（卡片文件读不出来：' + String(error?.message ?? error) + '）')
      return lines.join('\n')
    }
    // 正文去掉 frontmatter：上面已经把六个字段列成摘要了，重复一遍只是噪音。
    const text = parseShotCard(body).body.trim()
    if (text.length > MAX_PROMPT_CHARS) {
      lines.push(text.slice(0, MAX_PROMPT_CHARS))
      lines.push('', '…（卡片还有 ' + (text.length - MAX_PROMPT_CHARS) + ' 字，直接读文件：' + entry.filePath + '）')
    } else {
      lines.push(text)
    }
    lines.push('', '下一步：anim_shot_preview(id) 看海报；anim_shot_export(ids=[...]) 把卡和海报导出到工作目录。')
    return lines.join('\n')
  }

  ctx.tools.register(defineTool({
    name: 'anim_shot_stats',
    description: '排动效 / 视频 / 片头前先看家底：124 张镜头配方卡、10 个分类各多少张、150 个镜头风格、54 张海报、能量分布，以及上游仓库与在线样片地址。',
    parameters: {},
    output: textOutput,
    async execute() {
      let data
      try {
        data = getShotCatalog()
      } catch (error) {
        return shotsErrorText(error)
      }
      return JSON.stringify({
        ...shotStats(data),
        catalogPath: data.catalogPath,
        hint: '下一步：anim_shot_search(query="开场") 找卡；anim_shot_show(id) 读配方；anim_shot_preview(id) 看海报；anim_shot_guide 看完整用法。',
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_shot_search',
    description: '设计动效顺序时用（开场、转场、文字、界面登场、数据、光效、节奏、收尾）：按关键词 / 分类 / 标签 / 能量检索 124 张镜头配方卡。关键词会同时搜卡片正文（deep，默认开），每词都必须命中；再用 anim_shot_show 读细节。',
    parameters: {
      query: { type: 'string', description: '关键词，例如「墨线开场」「数字滚动」「打字机」；也可以直接填 id（opening/brand-ink-open）或卡片名。' },
      category: { type: 'string', description: '限定分类：opening / camera / transition / typography / ui-entrance / interaction / data / effects / rhythm / outro。' },
      tag: { type: 'string', description: '限定标签（只有 50 张卡带标签，例如 typography、3d）。' },
      energy: { type: 'string', description: '限定能量档：低 / 中 / 高。' },
      preview: { type: 'boolean', description: 'true 只看有海报的，false 只看没海报的。' },
      deep: { type: 'boolean', description: 'false = 只搜元信息，不进卡片正文（默认进正文）。' },
      limit: { type: 'number', description: '最多返回多少条，默认 20，上限 200。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getShotCatalog()
      } catch (error) {
        return shotsErrorText(error)
      }
      const rows = searchShots(data, {
        query: textOf(args?.query),
        category: textOf(args?.category),
        tag: textOf(args?.tag),
        energy: textOf(args?.energy),
        preview: typeof args?.preview === 'boolean' ? args.preview : null,
        deep: args?.deep !== false,
        limit: args?.limit,
      })
      return JSON.stringify({
        query: textOf(args?.query),
        category: textOf(args?.category),
        count: rows.length,
        total: data.cards,
        results: rows.map((row) => summarizeShot(row.entry, row.hits.length > 0 ? { hits: row.hits } : {})),
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_shot_show',
    description: '读一张镜头配方卡全文再动手：意图、动效核心、参数表、声音、已知坑、参考实现（上游 Remotion 文件路径），外加海报路径与在线样片地址。id 形如 opening/brand-ink-open，也可以只写卡片名。',
    parameters: {
      id: { type: 'string', required: true, description: '卡片 id（opening/brand-ink-open）、卡片名（brand-ink-open）或一句话标题。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getShotCatalog()
      } catch (error) {
        return shotsErrorText(error)
      }
      const found = resolveShot(data, args?.id)
      if (found.kind === 'ambiguous') {
        return '「' + String(args?.id ?? '') + '」对上了多张卡，用完整 id 指定一个：\n' +
          found.candidates.map((row) => '- ' + row.id).join('\n')
      }
      if (!found.entry) {
        return '找不到镜头卡「' + String(args?.id ?? '') + '」。用 anim_shot_search 按关键词或分类找，anim_shot_stats 看有哪些分类。'
      }
      return renderShotCard(found.entry)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_shot_preview',
    description: '看镜头卡画面：海报（上游 gallery 的静帧）的本地 JPG 路径，可直接交给看图工具；一次最多 12 张。没配图的卡会如实说明。',
    parameters: {
      id: { type: 'string', description: '一张卡的 id，例如 opening/brand-ink-open。' },
      ids: { type: 'array', items: { type: 'string' }, description: '一次要多个：["opening/brand-ink-open","transition/..."], 最多 12 个。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getShotCatalog()
      } catch (error) {
        return shotsErrorText(error)
      }
      const asked = []
      if (Array.isArray(args?.ids)) asked.push(...args.ids)
      if (typeof args?.id === 'string' && args.id.trim()) asked.push(args.id)
      const wanted = [...new Set(asked.map((v) => String(v).trim()).filter(Boolean))].slice(0, 12)
      if (wanted.length === 0) return '给一个 id（例如 opening/brand-ink-open），或用 ids 一次给多个（最多 12 个）。'
      const lines = []
      for (const value of wanted) {
        const found = resolveShot(data, value)
        if (!found.entry) {
          lines.push('- ' + value + '：找不到（用 anim_shot_search 检索）')
          continue
        }
        const preview = shotPreviewPath(found.entry)
        const shortTitle = found.entry.title.length > 40 ? found.entry.title.slice(0, 40) + '…' : found.entry.title
        lines.push('- ' + found.entry.id + ' ' + shortTitle + '：' +
          (preview || '（这张卡上游没配海报，看在线样片 ' + (found.entry.galleryUrl || SHOTS_GALLERY) + '）'))
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_shot_export',
    description: '定稿后把选中的镜头卡连同海报复制成能直接交活的目录：每张卡 <卡名>/<卡名>.md + <卡名>.jpg + README.md（怎么用、上游实现路径），再写一份 index.md 总表。拒绝写进插件目录。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, description: '要导出的卡片 id 列表，例如 ["opening/brand-ink-open","data/big-number-count-up"]。' },
      id: { type: 'string', description: '只导出一张时可直接传 id。' },
      category: { type: 'string', description: '不写 ids 时，按分类批量导出（例如 opening）。' },
      tag: { type: 'string', description: '配合 category：只导出带这个标签的。' },
      limit: { type: 'number', description: '按分类批量导出时最多多少张，默认 24。' },
      dir: { type: 'string', description: '导出到哪个目录（绝对路径或相对当前目录）；省略则用配置 shotsExportDir，再否则 <当前目录>/shot-cards。' },
    },
    output: textOutput,
    async execute(args, exec) {
      let data
      try {
        data = getShotCatalog()
      } catch (error) {
        return shotsErrorText(error)
      }
      const wanted = []
      const pushId = (value) => {
        const text = String(value ?? '').trim()
        if (text) wanted.push(text)
      }
      if (Array.isArray(args?.ids)) args.ids.forEach(pushId)
      pushId(args?.id)

      const entries = []
      const unknown = []
      for (const value of [...new Set(wanted)]) {
        const found = resolveShot(data, value)
        if (found.entry) entries.push(found.entry)
        else unknown.push(value)
      }

      const category = textOf(args?.category)
      const tag = textOf(args?.tag)
      if (entries.length === 0 && !category) {
        return '没有给出要导出的卡。传 ids: ["opening/brand-ink-open"]，或用 category: "opening" 批量导出。先用 anim_shot_search 挑。'
      }
      if (entries.length === 0) {
        entries.push(...searchShots(data, {
          category,
          tag,
          deep: false,
          limit: args?.limit,
        }).map((row) => row.entry))
      }
      if (entries.length === 0) return '这些条件下没有命中镜头卡，换个分类或关键词试试。'

      const dir = resolveShotExportDir(args, exec)
      const result = exportShots(data, entries, { dir })
      if (result.error) return '导出失败：' + result.error
      return JSON.stringify({
        exportDir: result.dir,
        count: result.rows.filter((row) => !row.error).length,
        unknown,
        cards: result.rows.map((row) => ({
          id: row.id,
          ...(row.dir ? { dir: row.dir } : {}),
          poster: Boolean(row.poster),
          ...(row.error ? { error: row.error } : {}),
        })),
        files: result.files.length,
        hint: '卡片是配方：参数表 + 已知坑 + 上游 Remotion 实现路径。要现成代码就照「上游实现」那行的路径去 video-shotcraft 仓库取；只借镜头语言时按参数表在本机重做即可。',
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_shot_random',
    description: '没想清镜头时随机抽一张配方卡（可限定分类 / 标签 / 能量 / 有海报）并给出全文。',
    parameters: {
      category: { type: 'string', description: '限定分类，例如 opening、transition、data。' },
      tag: { type: 'string', description: '限定标签。' },
      energy: { type: 'string', description: '限定能量档：低 / 中 / 高。' },
      preview: { type: 'boolean', description: 'true 只抽有海报的。' },
    },
    output: textOutput,
    async execute(args) {
      let data
      try {
        data = getShotCatalog()
      } catch (error) {
        return shotsErrorText(error)
      }
      const entry = randomShot(data, {
        category: textOf(args?.category),
        tag: textOf(args?.tag),
        energy: textOf(args?.energy),
        preview: typeof args?.preview === 'boolean' ? args.preview : null,
      })
      if (!entry) return '这个组合下没有镜头卡（分类名对不对？用 anim_shot_stats 看分类列表）。'
      return renderShotCard(entry)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'anim_shot_guide',
    description: '动手前读一次：怎么用这 124 张镜头卡——卡里有什么、十类怎么分工、从挑卡到成片的流程、和前三组数据源（提示词 / 特效 / 参考图）怎么搭、许可与维护。',
    parameters: {},
    output: textOutput,
    async execute() {
      const guidePath = join(ROOT, 'docs', 'shots.md')
      try {
        return readFileSync(guidePath, 'utf8')
      } catch (error) {
        return '读取镜头卡指南失败：' + String(error?.message ?? error) + '\n路径：' + guidePath
      }
    },
  }))

  log(
    'anim-pack: ready, library at ' + libraryRoot +
    ' | effects catalog at ' + join(ROOT, 'assets', 'fx', 'catalog.json') +
    (fxRoot ? ' (mirror ' + fxRoot + ')' : '') +
    ' | shot cards at ' + join(ROOT, 'assets', 'shots', 'index.json'),
  )
}
