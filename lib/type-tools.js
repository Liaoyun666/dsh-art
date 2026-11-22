
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ICON_GROUPS,
  brandKit,
  exportTypeGallery,
  fetchIconFiles,
  fontCss,
  generateBackground,
  renderType,
  resolveType,
  searchFonts,
  searchIconGroup,
  searchType,
  typeAudit,
  typeStats,
} from './type.js'

const NL = String.fromCharCode(10)
const F = String.fromCharCode(96).repeat(3)
const T = (lines) => lines.filter((line) => line !== null && line !== undefined && line !== '').join(NL)
const KIND_LABEL = {
  effect: '艺术字 / 文字特效',
  motion: '文字动效',
  decor: '装饰件',
  background: '背景生成',
  illustration: '插画外接',
  font: '字体种子',
}
const SEV_LABEL = { 3: '必修（最影响可读性）', 2: '该修', 1: '可选 / 锦上添花' }
const JOIN_CN = '、'

function kebab(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'type'
}

export function registerTypeTools({ ctx, defineTool, textOutput, ROOT, config, log, getLibrary }) {
  const exportRoot = (args, exec) => {
    const explicit = typeof args?.dir === 'string' ? args.dir.trim() : ''
    if (explicit) return resolve(explicit)
    if (config.typeExportDir) return resolve(config.typeExportDir)
    const cwd = exec?.agent?.session?.cwd ?? process.cwd()
    return join(cwd, 'anim-type')
  }

  // ① 家底 ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_type_stats',
    description: '看一眼文字与美化素材库的家底：180 条配方分六类（艺术字/文字特效 37、文字动效 16、装饰件 32、背景 14、插画外接 10、字体种子 71），各类分类与字体来源分布。做标题排版、海报、封面、按钮文字、背景纹理前先调它，再决定搜哪类。',
    parameters: {},
    output: textOutput,
    async execute() {
      try {
        const lib = getLibrary()
        const buckets = { effect: lib.effects, motion: lib.motion, decor: lib.decor, background: lib.background, illustration: lib.illustration, font: lib.fonts }
        const total = Object.keys(buckets).reduce((sum, key) => sum + buckets[key].length, 0)
        const lines = ['# 文字与美化素材 · 6 类 ' + total + ' 条', '']
        for (const key of ['effect', 'motion', 'decor', 'background', 'illustration', 'font']) {
          const rows = buckets[key] || []
          const cats = {}
          for (const row of rows) {
            const name = row.category || '未分类'
            cats[name] = (cats[name] || 0) + 1
          }
          const catText = Object.keys(cats).length > 0
            ? '（' + Object.keys(cats).slice(0, 12).map((name) => name + ' ' + cats[name]).join(' / ') + '）'
            : ''
          lines.push('- ' + KIND_LABEL[key] + '：' + rows.length + ' 条' + catText)
        }
        const fontSources = {}
        for (const font of lib.fonts) fontSources[font.source] = (fontSources[font.source] || 0) + 1
        lines.push('- 字体来源：' + Object.keys(fontSources).map((name) => name + ' ' + fontSources[name]).join(' / '))
        const cjk = lib.fonts.filter((font) => font.cjk).length
        lines.push('- 中文字体种子：' + cjk + ' 条（含 Noto Sans/Serif SC、马善政、志莽行书、龙藏、ZCOOL、Smiley Sans、LXGW 文楷、HarmonyOS、MiSans）')
        if (lib.errors && lib.errors.length > 0) {
          lines.push('', '## 读取告警', ...lib.errors.map((item) => '- ' + item))
        }
        lines.push('', '## 怎么用')
        lines.push('- 找艺术字 / 标题样式：anim_type_search(query="霓虹 描边") → anim_type_show(id="…") 拿 HTML + CSS。')
        lines.push('- 要整套配色与字阶：anim_brand_kit(theme="…")；要背景：anim_background(preset="mesh")。')
        lines.push('- 挑字体：anim_font_search(query="中文 衬线") → anim_font_css(family="…")。')
        lines.push('', '下一步：anim_type_search 或 anim_brand_kit。')
        return lines.join(NL)
      } catch (error) {
        return '读不到文字库：' + String(error && error.message ? error.message : error)
      }
    },
  }))

  // ② 检索 ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_type_search',
    description: '做标题、封面、海报、按钮文字、装饰线、背景纹理时在这里找现成配方：搜 180 条（艺术字/文字特效/文字动效/装饰件/背景/插画外接）。支持中文词与同义词（水墨→国风/书法，霓虹→发光，高级→柔光/衬线），可限定 kind 与 category，返回 id、用途与参数提示。',
    parameters: {
      query: { type: 'string', description: '关键词，例如「水墨 竖排」「霓虹 描边」「撕纸 分隔」「金属 大字」；可留空只按 kind / category 过滤。' },
      kind: { type: 'string', description: '限定类别：effect 艺术字/文字特效、motion 文字动效、decor 装饰件、background 背景、illustration 插画外接、font 字体。' },
      category: { type: 'string', description: '限定分类：例如 divider / border / frame / texture / light / sticker（装饰），sans / serif / display / mono / hand / cjk（字体）。' },
      tags: { type: 'array', items: { type: 'string' }, description: '限定标签，多个词都要命中，例如 ["国风","竖排"]。' },
      limit: { type: 'number', description: '返回多少条，默认 20，上限 80。' },
    },
    output: textOutput,
    async execute(args) {
      try {
        const lib = getLibrary()
        const hit = searchType(lib, {
          query: args?.query,
          kind: args?.kind,
          category: args?.category,
          tags: Array.isArray(args?.tags) ? args.tags : [],
          limit: args?.limit,
        })
        const lines = ['# 文字与美化检索 · ' + (args?.kind ? KIND_LABEL[args.kind] || args.kind : '全部类别') + ' · ' + hit.total + ' 条命中', '']
        if (hit.expanded && hit.expanded.length > 0) lines.push('- 同义词展开：' + hit.expanded.join('；'))
        if (hit.relaxed) lines.push('- 没有词全命中，下面是部分命中（按相关度排序）。')
        lines.push('')
        if (hit.total === 0) {
          lines.push('没有命中。换更短的词（「霓虹」「水墨」「撕纸」），或去掉 kind / category 限制再搜。')
          return lines.join(NL)
        }
        for (const row of hit.rows) {
          const entry = row.entry
          lines.push('- [' + entry.kind + '] ' + entry.name + '（' + (entry.category || '未分类') + '）· id=' + entry.id)
          if (entry.when) lines.push('  何时用：' + entry.when)
          if (Array.isArray(entry.tags) && entry.tags.length > 0) lines.push('  标签：' + entry.tags.join(JOIN_CN))
        }
        lines.push('', '下一步：anim_type_show(id="' + hit.rows[0].entry.id + '") 拿完整 HTML / CSS / 参数；要批量看效果用 anim_type_export(ids=["…","…"])。')
        return lines.join(NL)
      } catch (error) {
        return '检索失败：' + String(error && error.message ? error.message : error)
      }
    },
  }))

  // ③ 详情 ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_type_show',
    description: '拿一条配方的完整体：艺术字给可直接粘的 HTML + CSS、参数与已知坑；动效给 keyframes；背景给 CSS 模板与配色占位；字体给来源/字重/许可。做标题样式、装饰件、背景时，先 search 再 show 这条。',
    parameters: {
      id: { type: 'string', required: true, description: '配方 id（也可用名字或其 kebab 形式），例如 hollow-outline、neon-glow、mesh、noto-sans-sc。' },
    },
    output: textOutput,
    async execute(args) {
      const id = typeof args?.id === 'string' ? args.id.trim() : ''
      if (!id) return '要给配方 id，例如 anim_type_show(id="hollow-outline")。先用 anim_type_search 搜。'
      let lib
      try {
        lib = getLibrary()
      } catch (error) {
        return '读不到文字库：' + String(error && error.message ? error.message : error)
      }
      const found = resolveType(lib, id)
      if (found.kind === 'missing') {
        return '没找到「' + id + '」。先用 anim_type_search(query="…") 搜一下，或 anim_type_stats 看有哪些类别。'
      }
      if (found.kind === 'ambiguous') {
        return T([
          '「' + id + '」能对上多条：',
          '',
          ...found.candidates.map((entry) => '- ' + entry.id + ' · ' + entry.name + '（' + entry.kind + '）'),
          '',
          '请用完整 id 再调一次。',
        ])
      }
      const entry = found.entry
      const bucket = lib[entry.kind === 'font' ? 'fonts' : entry.kind === 'illustration' ? 'illustration' : entry.kind === 'background' ? 'background' : entry.kind === 'motion' ? 'motion' : entry.kind === 'decor' ? 'decor' : 'effects']
      const siblings = bucket.filter((item) => item.id !== entry.id && item.category === entry.category).slice(0, 3)
      return T([
        renderType(entry),
        '',
        siblings.length > 0 ? '## 同族（' + (entry.category || '未分类') + '）' : '',
        ...siblings.map((item) => '- ' + item.id + ' · ' + item.name),
        '',
        '下一步：把 CSS 粘进项目；要换配色用 anim_background / anim_brand_kit 的变量；要看整页效果用 anim_type_export。',
      ])
    },
  }))

  // ④ 导出画廊 ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_type_export',
    description: '把搜到的文字配方 / 装饰件 / 背景导出成一个本地画廊 HTML（每卡 iframe 隔离，附 HTML 与 CSS 源码），可以直接在浏览器里挑样式、截图给客户看。做标题风格对比、装饰件选型、背景比对时用。',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, description: '要导出的配方 id 列表；不写则导出该类全部。' },
      kind: { type: 'string', description: '不写 ids 时按类别批量：effect / motion / decor / background。' },
      dir: { type: 'string', description: '输出目录；默认 config.typeExportDir，否则 <工作目录>/anim-type。' },
      title: { type: 'string', description: '画廊标题。' },
    },
    output: textOutput,
    async execute(args, exec) {
      let lib
      try {
        lib = getLibrary()
      } catch (error) {
        return '读不到文字库：' + String(error && error.message ? error.message : error)
      }
      const dir = exportRoot(args, exec)
      try {
        const out = exportTypeGallery(lib, {
          ids: Array.isArray(args?.ids) ? args.ids : [],
          kind: args?.kind,
          dir,
          title: args?.title,
        })
        return T([
          '# 画廊已导出 · ' + out.count + ' 条',
          '',
          '- 文件：' + out.file,
          '- 包含：' + out.ids.slice(0, 20).join(', ') + (out.ids.length > 20 ? ' …' : ''),
          '',
          '下一步：浏览器打开这个 HTML 逐条看；选中的 id 用 anim_type_show 拿源码。',
        ])
      } catch (error) {
        return '导出失败：' + String(error && error.message ? error.message : error)
      }
    },
  }))

  // ⑤ 字体检索 ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_font_search',
    description: '选字体时用：在 71 条字体种子里按用途/语言/字重挑（中文 Noto Sans/Serif SC、马善政、志莽行书、龙藏、Smiley Sans、LXGW 文楷；西文 Satoshi、Clash Display、Cabinet Grotesk、Inter…），给来源、字重、许可与搭配建议。做网页 / 海报 / PPT / 品牌标题先挑字体。',
    parameters: {
      query: { type: 'string', description: '关键词，例如「中文 衬线」「标题 粗」「手写」「等宽」。' },
      source: { type: 'string', description: '限定来源：google / fontshare / system。' },
      category: { type: 'string', description: '限定类别：sans / serif / display / mono / hand / cjk。' },
      cjk: { type: 'boolean', description: '只看支持中文的字体。' },
      limit: { type: 'number', description: '返回多少条，默认 12，上限 80。' },
    },
    output: textOutput,
    async execute(args) {
      let lib
      try {
        lib = getLibrary()
      } catch (error) {
        return '读不到文字库：' + String(error && error.message ? error.message : error)
      }
      let found
      try {
        found = searchFonts(lib, {
          query: args?.query,
          source: args?.source,
          category: args?.category,
          cjk: args?.cjk === true,
          limit: args?.limit,
        })
      } catch (error) {
        return '查字体失败：' + String(error && error.message ? error.message : error)
      }
      const rows = found.rows
      const lines = ['# 字体检索 · ' + found.total + ' 条命中' + (found.total > rows.length ? '（先列 ' + rows.length + ' 条）' : ''), '']
      if (rows.length === 0) {
        lines.push('没有命中。试「中文」「衬线」「标题」「等宽」，或去掉 cjk / source 限制。')
        return lines.join(NL)
      }
      for (const font of rows) {
        lines.push('- ' + font.family + '（' + font.source + ' / ' + font.category + (font.cjk ? ' / 含中文' : '') + '）· ' + (Array.isArray(font.weights) ? font.weights.join(' ') : font.weights || '常规'))
        lines.push('  许可：' + (font.license || '见来源页') + (font.pair ? ' · 搭配：' + font.pair : ''))
        if (font.note) lines.push('  说明：' + font.note)
      }
      lines.push('', '下一步：anim_font_css(family="' + rows[0].family + '") 拿 @import / <link> 与 font-family 兜底栈。')
      return lines.join(NL)
    },
  }))

  // ⑥ 字体 CSS ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_font_css',
    description: '拿到某个字体的可用 CSS：Google Fonts / Fontshare / Fontsource 的 @import 与 <link>、带中文兜底的 font-family 栈，可选把 CSS 存成本地文件。前端要引字体、PPT 导出前要确认字体可用时调它。',
    parameters: {
      family: { type: 'string', required: true, description: '字体名，例如 Noto Sans SC、Satoshi、Inter。' },
      source: { type: 'string', description: '来源：google（默认）/ fontshare / fontsource / system。' },
      weights: { type: 'array', items: { type: 'string' }, description: '要的字重，例如 ["400","700"]。' },
      subset: { type: 'string', description: 'google 子集：latin / chinese-simplified 等。' },
      text: { type: 'string', description: '只取这些字形的子集（Google Fonts text= 参数），适合标题。' },
      dir: { type: 'string', description: '给目录就把 CSS 写成 <dir>/font-<名字>.css。' },
    },
    output: textOutput,
    async execute(args) {
      const family = typeof args?.family === 'string' ? args.family.trim() : ''
      if (!family) return '要给字体名，例如 anim_font_css(family="Noto Sans SC")。'
      let out
      try {
        out = fontCss({
          family,
          source: args?.source,
          weights: Array.isArray(args?.weights) ? args.weights : [],
          subset: args?.subset,
          text: args?.text,
        })
      } catch (error) {
        return '生成 CSS 失败：' + String(error && error.message ? error.message : error)
      }
      const stack = out.stack || ('"' + out.family + '", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif')
      const lines = [
        '# ' + out.family + ' · ' + out.source,
        '',
        out.note ? '- 说明：' + out.note : '',
        '',
        '## 用法 A · @import',
        F + 'css',
        out.css,
        F,
        '',
        '## 用法 B · <link>',
        F + 'html',
        out.link,
        F,
        '',
        '## 字体栈',
        F + 'css',
        'font-family: ' + stack + ';',
        F,
      ]
      const dir = typeof args?.dir === 'string' ? args.dir.trim() : ''
      if (dir) {
        try {
          mkdirSync(dir, { recursive: true })
          const file = join(dir, 'font-' + kebab(out.family) + '.css')
          writeFileSync(file, out.css + NL + NL + '/* 字体栈：font-family: ' + stack + '; */' + NL, 'utf8')
          lines.push('', '## 已落盘', '- ' + file)
        } catch (error) {
          lines.push('', '写文件失败：' + String(error && error.message ? error.message : error))
        }
      }
      lines.push('', '下一步：标题用 anim_type_search(kind="effect")；字阶与行高照 anim_type_audit 的 15 条准则。')
      return T(lines)
    },
  }))

  // ⑦ 品牌套件 ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_brand_kit',
    description: '给定主题（咖啡店 / 科技 SaaS / 儿童教育…）一次生成整套视觉令牌：5 档配色、字体搭配（editorial / tech / swiss / humanist / cjk）、圆角与密度、图标风格、装饰风格、动效预算，并给出可直接粘的 CSS 变量。开新页面 / 落地页 / 品牌页、要统一配色与字阶时先调它。',
    parameters: {
      theme: { type: 'string', required: true, description: '主题或产品，一句话，例如「手冲咖啡工作室」「AI 写作工具官网」「儿童绘本 App」。' },
      palette: { type: 'string', description: '指定色板：ink / warm / forest / candy / mono；不写按 theme 猜。' },
      pairing: { type: 'string', description: '指定字体搭配：editorial / tech / swiss / humanist / cjk；不写按 theme 猜。' },
      dark: { type: 'boolean', description: '要深色版。' },
      dir: { type: 'string', description: '给目录就把 CSS 变量写成 <dir>/tokens.css。' },
    },
    output: textOutput,
    async execute(args) {
      const theme = typeof args?.theme === 'string' ? args.theme.trim() : ''
      if (!theme) return '要给主题，例如 anim_brand_kit(theme="手冲咖啡工作室，温暖朴素")。'
      let kit
      try {
        kit = brandKit({ theme, palette: args?.palette, pairing: args?.pairing, dark: args?.dark === true })
      } catch (error) {
        return '生成失败：' + String(error && error.message ? error.message : error)
      }
      const COLOR_LABEL = { bg: '底色', surface: '卡片面', text: '正文', muted: '次要文字', accent: '主强调', accent2: '次强调' }
      const lines = [
        '# 品牌套件 · ' + kit.theme,
        '',
        '- 色板：' + kit.palette.name + '（' + kit.palette.id + '）· 字体搭配：' + kit.pairing.name + (args?.dark ? ' · 深色版' : ' · 浅色版'),
        '- 圆角：' + kit.tokens.radius.md + 'px（小 ' + kit.tokens.radius.sm + ' / 大 ' + kit.tokens.radius.lg + '）',
        '- 图标风格：' + kit.iconStyle,
        '- 装饰风格：' + kit.decorStyle,
        '- 动效预算：' + kit.motionBudget,
        '',
        '## 色板',
      ]
      const color = kit.tokens.color || {}
      for (const key of Object.keys(color)) lines.push('- ' + (COLOR_LABEL[key] || key) + '：' + color[key])
      lines.push('', '## 字体（' + kit.pairing.name + '）')
      const font = kit.tokens.font || {}
      if (font.display) lines.push('- 标题：' + font.display)
      if (font.text) lines.push('- 正文：' + font.text)
      if (kit.pairing.note) lines.push('- 说明：' + kit.pairing.note)
      const textScale = kit.tokens.text || {}
      if (Object.keys(textScale).length > 0) lines.push('- 字阶：' + Object.keys(textScale).map((key) => key + ' ' + textScale[key]).join(' / '))
      lines.push('', '## CSS 变量', F + 'css', kit.cssVars, F)
      const dir = typeof args?.dir === 'string' ? args.dir.trim() : ''
      if (dir) {
        try {
          mkdirSync(dir, { recursive: true })
          const file = join(dir, 'tokens.css')
          writeFileSync(file, kit.cssVars + NL, 'utf8')
          lines.push('', '## 已落盘', '- ' + file)
        } catch (error) {
          lines.push('', '写文件失败：' + String(error && error.message ? error.message : error))
        }
      }
      lines.push('', '## 下一步')
      lines.push('- 背景：anim_background(preset="mesh")，或 anim_type_search(kind="background")。')
      lines.push('- 图标：anim_icon_group(group="ui", query="arrow")；图片素材：anim_asset_search(tone="' + (args?.palette || 'warm') + '")。')
      lines.push('- 标题样式：anim_type_search(kind="effect", query="…")。')
      return T(lines)
    },
  }))

  // ⑧ 背景生成 ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_background',
    description: '生成页面/卡片/海报背景的 CSS：14 种预设（mesh 渐变、极光、网格、点阵、蓝图、纸纹、星空、波浪、锥形、聚光、斜纹、半调、等高线）按给定色板替换占位，返回 CSS 与用法。要首屏大背景、卡片底纹、PPT 背景时调它，不用自己调渐变。',
    parameters: {
      preset: { type: 'string', description: '预设 id：mesh / aurora / noise-gradient / grid / dots / blueprint / paper / starfield / waves / conic / spotlight / diagonal / halftone / topo；不写给 mesh。' },
      colors: { type: 'array', items: { type: 'string' }, description: '替换色，按顺序填入 c1 / c2 / c3 / base，例如 ["#0b1020","#4f46e5","#22d3ee","#05070f"]。' },
      css: { type: 'string', description: '直接给自定义 CSS（覆盖预设），例如 linear-gradient(...)。' },
      name: { type: 'string', description: '自定义名字。' },
      dir: { type: 'string', description: '给目录就额外写 <dir>/background.css 与 preview.html。' },
    },
    output: textOutput,
    async execute(args) {
      let out
      try {
        let input
        if (args?.css) {
          input = { id: args?.name || 'custom', name: args?.name || '自定义背景', css: args.css }
        } else {
          const lib = getLibrary()
          const wanted = String(args?.preset || 'mesh').toLowerCase()
          const found = lib.background.find((item) => item.id === wanted) || lib.background.find((item) => item.name === args?.preset)
          if (!found) {
            return '不认识的背景预设「' + wanted + '」。可选：' + lib.background.map((item) => item.id).join(' / ') + '。'
          }
          input = found
        }
        out = generateBackground(input, Array.isArray(args?.colors) ? args.colors : [])
      } catch (error) {
        return '生成失败：' + String(error && error.message ? error.message : error)
      }
      const bgLine = out.css.split(NL).map((line) => line.trim()).filter((line) => line.indexOf('background') === 0 || line.indexOf('background-image') === 0).join(' ')
      const lines = [
        '# 背景 · ' + out.name + (out.id && out.id !== out.name ? '（' + out.id + '）' : ''),
        '',
        F + 'css',
        out.css,
        F,
        '',
        '## 用法',
        F + 'css',
        '.hero { position: relative; isolation: isolate; }',
        '.hero::before { content: ""; position: absolute; inset: 0; z-index: -1; ' + bgLine + ' }',
        F,
      ]
      if (out.vars && Object.keys(out.vars).length > 0) {
        lines.push('', '## 变量', ...Object.keys(out.vars).map((key) => '- ' + key + '：' + out.vars[key]))
      }
      if (out.extra) lines.push('', '提示：' + out.extra)
      const dir = typeof args?.dir === 'string' ? args.dir.trim() : ''
      if (dir) {
        try {
          mkdirSync(dir, { recursive: true })
          const cssFile = join(dir, 'background.css')
          writeFileSync(cssFile, out.css + NL, 'utf8')
          const html = '<!doctype html><meta charset="utf-8"><title>' + out.name + '</title>' + NL +
            '<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;font:600 32px/1.3 system-ui,sans-serif;color:#fff}' + NL + out.css + NL + '</style>' + NL +
            '<div style="position:fixed;inset:0;z-index:-1"></div><h1>' + out.name + '</h1>'
          const htmlFile = join(dir, 'preview.html')
          writeFileSync(htmlFile, html, 'utf8')
          lines.push('', '## 已落盘', '- ' + cssFile, '- ' + htmlFile)
        } catch (error) {
          lines.push('', '写文件失败：' + String(error && error.message ? error.message : error))
        }
      }
      lines.push('', '下一步：配色拿 anim_brand_kit 的 CSS 变量；要纹理叠加用 anim_type_search(kind="decor", category="texture")。')
      return T(lines)
    },
  }))

  // ⑨ 图标组 ───────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_icon_group',
    description: '按用途找图标集合并取 SVG：6 组（ui=Lucide/Phosphor/Tabler、solid=Material/MDI、game=game-icons、brand=Simple Icons、emoji=Twemoji、arrows）走 Iconify API，可直接下载 SVG 文件进项目。做导航、按钮、空状态、功能列表要图标时调它。',
    parameters: {
      group: { type: 'string', description: '图标组：ui（默认）/ solid / game / brand / emoji / arrows。' },
      query: { type: 'string', description: '要找什么，例如 arrow、home、rocket、settings；不写就给该组常用图标。' },
      limit: { type: 'number', description: '返回多少条，默认 16。' },
      download: { type: 'boolean', description: 'true 就把 SVG 落到 dir。' },
      dir: { type: 'string', description: '下载目录。' },
      color: { type: 'string', description: '颜色，例如 %230f172a 或 currentColor。' },
      height: { type: 'number', description: 'SVG 高度像素，默认 24。' },
    },
    output: textOutput,
    async execute(args) {
      const group = String(args?.group || 'ui').toLowerCase()
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (!query) {
        // 没给关键词时不要空手去调 API（Iconify 会 400），直接把六组摆出来让人选。
        const lines = ['# 图标组 · ' + ICON_GROUPS.length + ' 组（每组都能按关键词查、能下 SVG）', '']
        for (const item of ICON_GROUPS) lines.push('- ' + item.id + ' · ' + item.name + '（' + item.prefixes.join(' / ') + '）—— ' + item.when)
        lines.push('', '下一步：anim_icon_group(group="ui", query="arrow") 查图标；加 download=true 与 dir="assets/icons" 直接把 SVG 落盘。')
        return T(lines)
      }
      const def = ICON_GROUPS.find((item) => item.id === group)
      if (!def) return '不认识的图标组「' + group + '」。可选：' + ICON_GROUPS.map((item) => item.id).join(' / ') + '。'
      let found
      try {
        found = await searchIconGroup(group, { query, limit: args?.limit })
      } catch (error) {
        return '查图标失败（Iconify API）：' + String(error && error.message ? error.message : error)
      }
      const icons = found.rows.map((row) => row.icon)
      const lines = ['# 图标 · ' + def.name + '（' + group + '）· ' + query + ' · ' + icons.length + ' 个', '', '- 集合：' + def.prefixes.join(' / ') + ' · ' + def.stroke + ' · 适合：' + def.when, '']
      for (const icon of icons) lines.push('- ' + icon + ' → https://api.iconify.design/' + icon.replace(':', '/') + '.svg')
      if (args?.download === true) {
        const dir = typeof args?.dir === 'string' ? args.dir.trim() : ''
        if (!dir) return T([...lines, '', '要下载得给 dir，例如 anim_icon_group(group="' + group + '", download=true, dir="assets/icons")。'])
        try {
          const rows = await fetchIconFiles(icons, { dir, height: args?.height, color: args?.color })
          lines.push('', '## 已落盘 · ' + dir)
          for (const row of rows) lines.push(row.error ? '- 失败 · ' + row.icon + ' · ' + row.error : '- ' + row.icon + ' → ' + row.file + '（' + row.bytes + 'B）')
        } catch (error) {
          lines.push('', '下载失败：' + String(error && error.message ? error.message : error))
        }
      }
      lines.push('', '下一步：要统一风格就固定一个集合（ui → lucide 或 ph）；品牌图标用 group="brand"。')
      return T(lines)
    },
  }))

  // ⑩ 排版体检 ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'anim_type_audit',
    description: '排版自检清单：15 条硬规则（字阶比例、行高、行长 45–75 字符、字距、字重层级、中英混排加空格、数字等宽、对比度 4.5:1、最小字号、标点、避头尾、全大写、对齐、链接可辨、字体兜底），按必修/该修/可选分级并给修法。页面、海报、PPT 排版交付前跑一次。',
    parameters: {
      scope: { type: 'string', description: '画面类型（可选）：page / article / dashboard / poster / deck，用来排序重点。' },
    },
    output: textOutput,
    async execute(args) {
      let audit
      try {
        audit = typeAudit({ scope: args?.scope })
      } catch (error) {
        return '读不到规则：' + String(error && error.message ? error.message : error)
      }
      const lines = ['# 排版体检 · ' + audit.total + ' 条 · ' + (audit.scope || '通用'), '']
      for (const sev of ['3', '2', '1']) {
        const rows = audit.rules.filter((rule) => String(rule.severity) === sev)
        if (rows.length === 0) continue
        lines.push('## ' + (SEV_LABEL[sev] || sev) + '（' + rows.length + '）')
        for (const rule of rows) {
          lines.push('- ' + rule.name + '：' + rule.check)
          if (rule.fix) lines.push('  修法：' + rule.fix)
        }
        lines.push('')
      }
      lines.push('下一步：字号/行高/配色照 anim_brand_kit 的 tokens 落地；字体栈用 anim_font_css。')
      return lines.join(NL)
    },
  }))

  log('anim-pack: type tools registered (10)')
}
