#!/usr/bin/env node
// tools/extract.mjs — 命令行版元素提取：不装插件、不进 DSH 也能用。
//
//   node tools/extract.mjs <图片> [--out 目录] [--top 6] [--max 1024] [--json]
//
// 输出目录里会有 report.md / brief.json / palette.png / contact.png / crops/*.png。

import { basename, resolve } from 'node:path'
import { extract } from '../lib/extract.js'

const argv = process.argv.slice(2)
const flags = {}
const files = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { flags[key] = next; i++ }
    else flags[key] = true
  } else files.push(a)
}

if (!files.length) {
  console.log('用法: node tools/extract.mjs <图片> [--out 目录] [--top 6] [--max 1024] [--no-crops] [--json]')
  process.exit(2)
}

const numFlag = (k, d) => (flags[k] !== undefined ? Number(flags[k]) : d)
const input = resolve(files[0])
let result
try {
  result = extract(input, {
    out: flags.out ? resolve(String(flags.out)) : undefined,
    top: numFlag('top', 6),
    maxSide: numFlag('max', 1024),
    colors: numFlag('colors', 12),
    cropSize: numFlag('crop-size', 160),
    crops: flags['no-crops'] ? false : true,
    palette: flags['no-palette'] ? false : true,
    contact: flags['no-contact'] ? false : true,
    debug: !!flags.debug,
  })
} catch (error) {
  console.error('提取失败：' + (error?.message ?? error))
  process.exit(1)
}

if (flags.json) {
  console.log(JSON.stringify({
    kind: result.kind,
    outDir: result.outDir,
    art: result.art,
    palette: result.palette,
    elements: result.elements,
    crops: result.crops,
    files: result.files,
    brief: result.brief,
    elapsedMs: result.elapsedMs,
  }, null, 2))
} else {
  const a = result
  console.log(basename(input) + '  ' + a.source.width + 'x' + a.source.height +
    ' → 分析 ' + a.analysis.width + 'x' + a.analysis.height +
    '  kind=' + a.kind +
    (a.art?.isPixelArt ? ' 像素画' + a.art.scale + 'x/' + a.art.uniqueColors + '色' : '') +
    '  ' + a.elapsedMs + 'ms')
  console.log('背景 ' + Math.round(a.background.share * 100) + '%  ' + (a.background.color ?? '') +
    (a.background.transparent ? '  (含透明)' : '') + (a.background.frame ? '  (装裱)' : ''))
  if (a.composition.horizon) console.log('地平线 ' + Math.round(a.composition.horizon.y * 100) + '%')
  console.log('元素 ' + a.elements.length + ' 个：')
  for (const e of a.elements.slice(0, 10)) {
    const b = e.bbox
    console.log('  #' + e.index + ' ' + e.role + (e.focal ? ' ★' : '') +
      '  ' + [b.x, b.y, b.w, b.h].join(',') +
      '  ' + (e.areaShare * 100).toFixed(1) + '%  ' + (e.colorZh ?? '') + ' ' + (e.color ?? ''))
  }
  console.log('调色板 ' + a.palette.slice(0, 8).map((p) => p.hex).join(' '))
  console.log('输出目录 ' + a.outDir)
  for (const f of a.files) console.log('  ' + f)
}
