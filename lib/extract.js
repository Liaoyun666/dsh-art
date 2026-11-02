// lib/extract.js — 从一张参考图里把「能用的东西」抠出来并写成文件。
//
// 输入一张图，输出一个目录：
//   report.md      中文分析报告（类型 / 构图 / 调色板 / 元素表 / 提示词）
//   brief.json     buildBrief() 的机器可读版本
//   palette.png    调色板色卡
//   contact.png    所有裁剪块的接触表（一眼看全）
//   crops/NN-<角色>.png   每个元素的裁剪（像素画按整数倍放大，照片保持原分辨率）
//
// 这里只做「测量 + 裁剪 + 组版」，不做语义猜测：角色名来自几何特征
// （竖长、落地、靠近中线），猜错了也只是标签难看，不影响裁剪坐标。

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

import { cropImage, encodePng, loadImage } from './image.js'
import { analyseImage } from './vision.js'
import { buildBrief } from './prompt.js'

const BT = String.fromCharCode(96)

/** 最近邻整数倍放大（像素画专用，不能插值，否则色带就烂了）。 */
export function upscaleNearest(img, factor) {
  const f = Math.max(1, Math.round(factor))
  if (f === 1) return img
  const w = img.width * f, h = img.height * f
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = (y / f) | 0
    for (let x = 0; x < w; x++) {
      const sx = (x / f) | 0
      const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4
      data[di] = img.data[si]; data[di + 1] = img.data[si + 1]
      data[di + 2] = img.data[si + 2]; data[di + 3] = img.data[si + 3]
    }
  }
  return { width: w, height: h, data }
}

/** 最近邻缩放到指定尺寸（组版用，宁可硬边也不要糊）。 */
export function resizeNearest(img, w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, ((y * img.height) / h) | 0)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, ((x * img.width) / w) | 0)
      const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4
      data[di] = img.data[si]; data[di + 1] = img.data[si + 1]
      data[di + 2] = img.data[si + 2]; data[di + 3] = img.data[si + 3]
    }
  }
  return { width: w, height: h, data }
}

/** 新建一块纯色画布。 */
export function canvas(w, h, rgba) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgba[0]; data[i * 4 + 1] = rgba[1]; data[i * 4 + 2] = rgba[2]; data[i * 4 + 3] = rgba[3] ?? 255
  }
  return { width: w, height: h, data }
}

/** 把 img 贴到 dst 的 (ox,oy)，按 alpha 混合。 */
export function blit(dst, img, ox, oy) {
  for (let y = 0; y < img.height; y++) {
    const dy = oy + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < img.width; x++) {
      const dx = ox + x
      if (dx < 0 || dx >= dst.width) continue
      const si = (y * img.width + x) * 4, di = (dy * dst.width + dx) * 4
      const a = img.data[si + 3] / 255
      if (a === 0) continue
      dst.data[di] = img.data[si] * a + dst.data[di] * (1 - a)
      dst.data[di + 1] = img.data[si + 1] * a + dst.data[di + 1] * (1 - a)
      dst.data[di + 2] = img.data[si + 2] * a + dst.data[di + 2] * (1 - a)
      dst.data[di + 3] = 255
    }
  }
  return dst
}

/** 色卡：每个颜色一块 size×size，深灰底，按占比从大到小排。 */
export function paletteImage(palette, size = 48, gap = 6) {
  const rows = palette.slice(0, 12)
  const w = Math.max(1, rows.length) * (size + gap) + gap
  const h = size + gap * 2
  const out = canvas(w, h, [26, 26, 30, 255])
  rows.forEach((p, i) => {
    const rgb = p.rgb ?? [128, 128, 128]
    blit(out, canvas(size, size, [rgb[0], rgb[1], rgb[2], 255]), gap + i * (size + gap), gap)
  })
  return out
}

/** 3×5 的像素数字。够用来在接触表上标序号，省得为了几个字引一整套字体。 */
const DIGITS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '-': ['000', '000', '111', '000', '000'], ' ': ['000', '000', '000', '000', '000'],
}

/** 在画布上写一排像素数字（scale 倍放大 + 1px 黑描边，深底浅底都看得清）。 */
export function drawText(dst, text, ox, oy, scale = 2, color = [240, 240, 245]) {
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return
    const i = (y * dst.width + x) * 4
    dst.data[i] = c[0]; dst.data[i + 1] = c[1]; dst.data[i + 2] = c[2]; dst.data[i + 3] = 255
  }
  const glyphs = String(text).split('')
  // 先把所有字形铺成一张点阵（含 1px 外扩），再一次性落笔：外扩涂黑、字形涂白
  const dots = []
  glyphs.forEach((ch, gi) => {
    const g = DIGITS[ch] ?? DIGITS[' ']
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (g[row][col] !== '1') continue
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            dots.push({ x: gi * 4 + col + dc, y: row + dr, ink: dc === 0 && dr === 0 })
          }
        }
      }
    }
  })
  for (const d of dots) {
    if (d.ink) continue
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(ox + d.x * scale + sx, oy + d.y * scale + sy, [10, 10, 12])
  }
  for (const d of dots) {
    if (!d.ink) continue
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(ox + d.x * scale + sx, oy + d.y * scale + sy, color)
  }
  return dst
}

/** 接触表：裁剪块按网格排，深色底，左下角标序号。items 可以是图，也可以是 {img,label}。 */
export function contactSheet(items, cell = 140, gap = 10, cols = 4, bg = [24, 24, 28]) {
  const n = items.length
  if (!n) return null
  const c = Math.min(4, Math.max(1, cols))
  const rows = Math.ceil(n / c)
  const out = canvas(c * cell + (c + 1) * gap, rows * cell + (rows + 1) * gap, [...bg, 255])
  items.forEach((item, i) => {
    const img = item.img ?? item
    const label = item.label ?? String(i)
    const cx = i % c, cy = Math.floor(i / c)
    const box = cell - 8
    const k = Math.min(box / img.width, box / img.height)
    const sw = Math.max(1, Math.round(img.width * k)), sh = Math.max(1, Math.round(img.height * k))
    const scaled = k >= 0.999 ? img : resizeNearest(img, sw, sh)
    const bx = gap + cx * (cell + gap), by = gap + cy * (cell + gap)
    blit(out, canvas(cell, cell, [40, 40, 46, 255]), bx, by)
    blit(out, scaled, bx + Math.round((cell - sw) / 2), by + Math.round((cell - sh) / 2))
    drawText(out, label, bx + 4, by + cell - 14, 2)
  })
  return out
}

const pct = (v) => Math.round((v ?? 0) * 100) + '%'
const num = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : '—')

export function safeName(s) {
  return String(s || 'x').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'
}

/** 主流程。opts: { out, top, crops, palette, contact, maxSide, colors, cropSize, debug } */
export function extract(file, opts = {}) {
  const started = Date.now()
  const img = loadImage(file)
  const analysis = analyseImage(img, {
    maxSide: opts.maxSide ?? 1024,
    colors: opts.colors ?? 12,
    debug: !!opts.debug,
  })
  const brief = buildBrief(analysis, { top: opts.top ?? 8, colors: opts.colors ?? 8 })

  const outDir = resolve(opts.out || join(process.cwd(), 'anim-extract', safeName(basename(file, extname(file)))))
  mkdirSync(outDir, { recursive: true })
  const files = []

  const writePng = (name, image) => {
    const target = join(outDir, name)
    writeFileSync(target, encodePng(image, { level: 9 }))
    files.push(target)
    return target
  }

  // 分析图 → 原图的坐标倍率（analysis 是缩小过的，裁剪要回原图才清晰）
  const k = img.width / analysis.analysis.width
  const pxScale = analysis.art?.isPixelArt ? Math.max(1, Math.round(analysis.art.scale || 1)) : 1
  const wantLong = Math.max(64, Math.min(256, opts.cropSize ?? 160))

  const crops = []
  // 无缝贴图没有「前景物体」：整张图会被切成几块同色区域，裁出来没意义，直接跳过。
  const wantCrops = opts.crops !== false && analysis.kind !== 'texture'
  if (wantCrops) {
    const top = Math.min(opts.top ?? 8, analysis.elements.length)
    mkdirSync(join(outDir, 'crops'), { recursive: true })
    for (let i = 0; i < top; i++) {
      const e = analysis.elements[i]
      const padA = Math.max(2, Math.round(Math.min(e.bbox.w, e.bbox.h) * 0.08))
      const x = Math.max(0, Math.round((e.bbox.x - padA) * k))
      const y = Math.max(0, Math.round((e.bbox.y - padA) * k))
      const w = Math.max(1, Math.min(img.width - x, Math.round((e.bbox.w + padA * 2) * k)))
      const h = Math.max(1, Math.min(img.height - y, Math.round((e.bbox.h + padA * 2) * k)))
      let piece = cropImage(img, x, y, w, h)
      // 像素画：按原生像素块整数倍放大，看的是「真形状」；照片：小了才放大
      let factor = 1
      if (pxScale > 1) factor = Math.max(1, Math.min(16, Math.round(wantLong / Math.max(w, h) / pxScale) * pxScale))
      else if (Math.max(w, h) < wantLong) factor = Math.max(1, Math.min(8, Math.floor(wantLong / Math.max(w, h))))
      if (factor > 1) piece = upscaleNearest(piece, factor)
      const name = join('crops', String(i).padStart(2, '0') + '-' + safeName(e.role) + '.png')
      const target = writePng(name, piece)
      crops.push({ index: i, role: e.role, bbox: e.bbox, sourceRect: { x, y, w, h }, scale: factor, file: target })
    }
  }

  if (opts.palette !== false) writePng('palette.png', paletteImage(analysis.palette))

  if (opts.contact !== false && crops.length > 1) {
    const cells = crops.map((c) => ({ img: loadImage(c.file), label: '#' + c.index }))
    const sheet = contactSheet(cells, 140, 10, Math.min(4, crops.length))
    if (sheet) writePng('contact.png', sheet)
  }

  writeFileSync(join(outDir, 'brief.json'), JSON.stringify(brief, null, 2))
  files.push(join(outDir, 'brief.json'))

  const report = buildReport({ file, img, analysis, brief, crops, outDir })
  writeFileSync(join(outDir, 'report.md'), report)
  files.push(join(outDir, 'report.md'))

  return {
    file,
    outDir,
    elapsedMs: Date.now() - started,
    kind: analysis.kind,
    art: analysis.art,
    source: analysis.source,
    analysis: analysis.analysis,
    scale: analysis.scale,
    background: {
      share: analysis.background.areaShare,
      color: analysis.background.color?.zh ?? null,
      transparent: analysis.background.isTransparent,
      frame: analysis.background.frame,
    },
    composition: analysis.composition,
    palette: analysis.palette.slice(0, 12).map((p) => ({ hex: p.hex, zh: p.zh, share: p.share, from: p.from })),
    elements: analysis.elements.map((e) => ({
      index: e.index,
      role: e.role,
      bbox: e.bbox,
      areaShare: e.areaShare,
      color: e.meanColor?.hex ?? null,
      colorZh: e.meanColor?.zh ?? null,
      focal: !!e.isFocal,
    })),
    crops,
    files,
    brief,
  }
}

/** 中文报告。只写测出来的数，不确定的地方直说不确定。 */
export function buildReport({ file, img, analysis, brief, crops, outDir }) {
  const a = analysis
  const L = []
  L.push('# ' + basename(file) + ' 参考图分析')
  L.push('')
  L.push('- 文件：' + BT + file + BT)
  L.push('- 原始尺寸：' + img.width + ' × ' + img.height + ' px')
  L.push('- 分析分辨率：' + a.analysis.width + ' × ' + a.analysis.height + ' px（倍率 ' + num(a.scale, 3) + '）')
  L.push('- 图片类型：**' + a.kind + '**（' + (a.tileable ? '可四方连续平铺，' : '') + '接缝差 横 ' + num(a.seam.horizontal, 1) + ' / 竖 ' + num(a.seam.vertical, 1) + '）')
  L.push('- 像素画：' + (a.art?.isPixelArt ? '是，像素块 ' + a.art.scale + 'x，' + a.art.uniqueColors + ' 种颜色' : '否（按照片 / 插画处理）'))
  L.push('')
  L.push('## 一句话')
  L.push('')
  L.push('> ' + brief.subject)
  L.push('')

  L.push('## 构图')
  L.push('')
  const c = a.composition
  L.push('- 画幅：' + c.aspect + '（' + c.orientation + '）')
  L.push('- 前景 / 背景：' + pct(c.fgShare) + ' / ' + pct(c.negativeSpace))
  L.push('- 地平线：' + (c.horizon ? '高度 ' + pct(c.horizon.y) + '（' + c.horizon.kind + '）' : '无（' + (a.background.frame ? '装裱画面' : '无天地分界') + '）'))
  L.push('- 视觉重心：(' + c.centroid.x + ', ' + c.centroid.y + ')，偏离中心 ' + c.centerBias)
  L.push('- 三分法命中：' + (c.thirdsHits.length ? c.thirdsHits.map((i) => '#' + i).join(' ') : '无'))
  L.push('- 镜像对称：' + c.symmetry + '；对比度（p5–p95 亮度）：' + c.contrastRatio)
  L.push('')

  L.push('## 调色板')
  L.push('')
  L.push('| 颜色 | 色值 | 占比 | 来源 |')
  L.push('|---|---|---|---|')
  for (const p of a.palette.slice(0, 12)) {
    L.push('| ' + (p.zh ?? '—') + ' | ' + BT + (p.hex ?? '—') + BT + ' | ' + pct(p.share) + ' | ' + (p.from ?? '') + ' |')
  }
  L.push('')

  L.push('## 元素')
  L.push('')
  L.push('元素是按「颜色 + 相邻 + 对齐」分组出来的**几何块**；角色一列是按形状推断的标签（竖长落地 → character 之类），不是语义识别。')
  L.push('')
  L.push('| # | 角色 | 位置 (x,y,w,h) | 占画面 | 填充率 | 主色 | 焦点 |')
  L.push('|---|---|---|---|---|---|---|')
  a.elements.slice(0, 12).forEach((e) => {
    L.push('| ' + e.index + ' | ' + e.role + ' | ' + [e.bbox.x, e.bbox.y, e.bbox.w, e.bbox.h].join(',') +
      ' | ' + pct(e.areaShare) + ' | ' + num(e.fill) + ' | ' + (e.meanColor?.zh ?? '—') + ' ' + BT + (e.meanColor?.hex ?? '') + BT + ' | ' +
      (e.isFocal ? '★' : '') + ' |')
  })
  L.push('')

  if (a.background.sky || a.background.ground) {
    L.push('## 天空 / 地面')
    L.push('')
    if (a.background.sky) L.push('- 天空：' + (a.background.sky.color?.zh ?? '—') + '，占 ' + pct(a.background.sky.areaShare) + '，到 y=' + a.background.sky.bottomY)
    if (a.background.ground) L.push('- 地面：' + (a.background.ground.color?.zh ?? '—') + '，占 ' + pct(a.background.ground.areaShare) + '，从 y=' + a.background.ground.topY + ' 起')
    L.push('')
  }

  L.push('## 运动线索')
  L.push('')
  if (brief.motion.length === 0) L.push('（没有可推断的主体，跳过）')
  for (const m of brief.motion) L.push('- **' + m.role + '**：' + m.zh + ' — ' + BT + m.act + BT)
  L.push('')

  L.push('## 提示词')
  L.push('')
  L.push('图像模型用：')
  L.push('')
  L.push(BT + BT + BT + 'text')
  L.push(brief.imagePrompt)
  L.push(BT + BT + BT)
  L.push('')
  L.push('代码特效用（pixelfx 口径）：')
  L.push('')
  L.push(BT + BT + BT + 'text')
  L.push(brief.fxPrompt)
  L.push(BT + BT + BT)
  L.push('')
  if (brief.searches.zh.length) {
    L.push('在这套素材包里继续找同调子：anim_search 搜 ' + brief.searches.zh.map((s) => '「' + s + '」').join('、') +
      (brief.searches.en.length ? '（英文：' + brief.searches.en.join(' / ') + '）' : ''))
    L.push('')
  }

  if (crops.length) {
    L.push('## 裁剪块')
    L.push('')
    for (const cr of crops) {
      const rel = cr.file.replace(outDir + '\\', '').replace(outDir + '/', '')
      L.push('- ' + BT + rel + BT + ' — #' + cr.index + ' ' + cr.role + '（放大 ' + cr.scale + 'x）')
    }
    L.push('')
  }

  L.push('## 说明与局限')
  L.push('')
  if (a.kind === 'texture') L.push('- 这是满幅纹理，**没有可分离的前景物体**：下面的「元素」是色块分区，不是独立物件，别当角色用。')
  if (a.kind === 'sprite-sheet') L.push('- 精灵表：' + (a.sheet?.count ?? 0) + ' 个小图、约 ' + (a.sheet?.rows ?? 0) + ' 行。裁剪块是逐个元素抠的，行列网格需要自己对齐。')
  if (a.kind === 'framed-artwork') L.push('- 装裱画面：外部留白 / 画框已经并进背景，天空地面的判定在这里不适用。')
  if (a.background.isTransparent) L.push('- 原图带透明通道（' + pct(a.background.transparentShare) + '），透明区域算作背景。')
  L.push('- 元素是几何分组结果：**同一物体的不同色块可能被拆开**（例如人物的头与身体），需要时按 bbox 手动合并。')
  L.push('- 不支持 WebP / HEIC：遇到会直接报错，请先另存为 PNG。')
  L.push('')
  return L.join('\n')
}
