#!/usr/bin/env node
/**
 * 校验 assets/design/ 的四份设计工艺库数据，并生成 catalog.json（计数 + 出处）。
 *
 *   node tools/build-design.mjs            # 校验并写 assets/design/catalog.json
 *   node tools/build-design.mjs --check    # 只校验，不写盘（计数与现文件不一致则 exit 1）
 *
 * 四份数据是手工译写的（不是上游文件复制），来源：
 *   Ilm-Alan/frontend-design（MIT）        → anchors.json 的八锚点、rules.json 的内容纪律
 *   MickeyAlton33/web-designer-plugin（MIT）→ patterns.json、rules.json 的配色/字体/动效
 *   mistyhx/frontend-design-audit（MIT）    → heuristics.json、rules.json 的反模式
 * 改数据时连同 lib/design.js 的检索逻辑与 tools/verify.mjs 的断言一起改。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DESIGN_DIR_REL,
  DESIGN_FILES,
  PATTERN_CATEGORIES,
  loadDesignLibrary,
} from '../lib/design.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN_DIR = join(ROOT, DESIGN_DIR_REL)
const OUT = join(DESIGN_DIR, 'catalog.json')
const checkOnly = process.argv.slice(2).includes('--check')

const problems = []
for (const name of DESIGN_FILES) {
  const file = join(DESIGN_DIR, name + '.json')
  if (!existsSync(file)) {
    problems.push('缺文件：' + file)
    continue
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object') problems.push(name + '.json 不是对象')
    else if (name !== 'rules' && !Array.isArray(data.entries)) problems.push(name + '.json 缺 entries 数组')
  } catch (error) {
    problems.push(name + '.json 解析失败：' + String(error?.message ?? error))
  }
}
if (problems.length > 0) {
  console.error('设计工艺库有问题：')
  for (const row of problems) console.error('  - ' + row)
  process.exit(1)
}

const lib = loadDesignLibrary(ROOT)
if (lib.missing.length > 0) {
  console.error('读不全：' + lib.missing.join('、'))
  process.exit(1)
}

const upstream = []
for (const source of [lib.anchors, lib.patterns, lib.heuristics, lib.rules]) {
  for (const row of source?.upstream ?? []) {
    if (!upstream.some((seen) => seen.name === row.name)) upstream.push(row)
  }
}

const catalog = {
  version: lib.anchors?.version ?? '1.0.0',
  generated: new Date().toISOString(),
  upstream,
  counts: lib.counts,
  patternCategories: PATTERN_CATEGORIES.map((row) => ({
    id: row.id,
    name: row.name,
    count: (lib.patterns?.entries ?? []).filter((entry) => entry.category === row.id).length,
  })),
  rules: {
    antiPatterns: (lib.rules?.antiPatterns ?? []).length,
    contentDiscipline: (lib.rules?.contentDiscipline ?? []).length,
    craftFloor: (lib.rules?.craftFloor ?? []).length,
    palettes: (lib.rules?.palettes ?? []).map((row) => row.id),
    typePairings: (lib.rules?.typePairings ?? []).map((row) => row.id),
    motionTiming: (lib.rules?.motionTiming ?? []).length,
  },
}

const json = JSON.stringify(catalog, null, 2) + '\n'

if (checkOnly) {
  if (!existsSync(OUT)) {
    console.error('catalog.json 不存在，跑一次 node tools/build-design.mjs')
    process.exit(1)
  }
  const current = JSON.parse(readFileSync(OUT, 'utf8'))
  const same = JSON.stringify(current.counts) === JSON.stringify(catalog.counts) &&
    JSON.stringify(current.patternCategories) === JSON.stringify(catalog.patternCategories)
  if (!same) {
    console.error('catalog.json 与数据不一致，跑一次 node tools/build-design.mjs 重建')
    process.exit(1)
  }
  console.log('design catalog ok: ' + JSON.stringify(catalog.counts))
  process.exit(0)
}

writeFileSync(OUT, json, 'utf8')
console.log('已写 ' + OUT)
console.log('  anchors ' + catalog.counts.anchors + ' / patterns ' + catalog.counts.patterns +
  ' / heuristics ' + catalog.counts.heuristics + ' / palettes ' + catalog.counts.palettes +
  ' / typePairings ' + catalog.counts.typePairings + ' / antiPatterns ' + catalog.counts.antiPatterns)
