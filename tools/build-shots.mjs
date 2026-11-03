#!/usr/bin/env node
/**
 * 重建 assets/shots/index.json：把 assets/shots/cards/ 下的 124 张镜头卡
 * 解析成一份宿主启动即可读的索引（不用在运行时解 YAML）。
 *
 *   node tools/build-shots.mjs            # 重建索引
 *   node tools/build-shots.mjs --check    # 只检查索引是否和卡片一致（不写盘）
 *   node tools/build-shots.mjs --commit <upstream-commit>
 *
 * 上游卡片来自 Vincentwei1021/video-shotcraft（Apache-2.0），卡片正文原样保留；
 * 这里只抽取 frontmatter 与「动效核心」首句，poster 用同名 jpg 匹配。
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SHOTS_CATALOG_REL,
  SHOT_CATEGORIES,
  SHOTS_GALLERY,
  SHOTS_UPSTREAM,
  demoOf,
  parseShotCard,
} from '../lib/shots.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS_DIR = join(ROOT, 'assets', 'shots')
const CARD_DIR = join(SHOTS_DIR, 'cards')
const POSTER_DIR = join(SHOTS_DIR, 'posters')
const OUT = join(ROOT, SHOTS_CATALOG_REL)

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const commitAt = args.indexOf('--commit')
const commit = commitAt !== -1 ? String(args[commitAt + 1] ?? '').trim() : ''

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (item.isDirectory()) out.push(...walk(full))
    else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) out.push(full)
  }
  return out.sort()
}

/** 「动效核心」一段的第一句，给列表页当一句话摘要。 */
function gistOf(body) {
  const match = String(body ?? '').match(/^##\s*动效核心\s*$\n+([^\n]+)/m)
  if (!match) return ''
  const text = match[1].trim().replace(/^[-*\d.、\s]+/, '')
  return text.length > 90 ? text.slice(0, 90) + '…' : text
}

/** 上游有 4 张 poster 用的是「镜头风格名」而不是卡片名，这里给它们留别名。 */
const POSTER_ALIAS = {
  'rhythm/panel-grid-moves': 'comic-panel-split',
  'interaction/theme-switch-moves': 'palette-theme-ripple',
  'effects/spotlight-sweep-moves': 'slide-spotlight-pan',
  'data/chart-live-moves': 'unit-dot-swarm-regroup',
}

const rows = []
for (const file of walk(CARD_DIR)) {
  const rel = file.slice(SHOTS_DIR.length + 1).split(/[\\/]/).join('/')
  const parts = rel.split('/')
  const category = parts.length >= 3 ? parts[1] : 'misc'
  const card = parts[parts.length - 1].replace(/\.md$/i, '')
  const parsed = parseShotCard(readFileSync(file, 'utf8'))
  const posterFile = POSTER_ALIAS[category + '/' + card] ?? card
  const posterRel = 'posters/' + posterFile + '.jpg'
  rows.push({
    id: category + '/' + card,
    card,
    category,
    categoryName: (SHOT_CATEGORIES.find((row) => row.id === category) ?? {}).name ?? category,
    title: parsed.title || parsed.meta.name || card,
    fit: parsed.fit,
    duration: parsed.duration,
    energy: parsed.energy,
    tags: parsed.tags,
    gist: gistOf(parsed.body),
    demo: demoOf(parsed.body),
    file: 'cards/' + rel.slice(parts[0].length + 1),
    preview: existsSync(join(SHOTS_DIR, posterRel)) ? posterRel : '',
    source: SHOTS_UPSTREAM + '/blob/main/references/shots/' + category + '/' + card + '.md',
  })
}

rows.sort((a, b) => a.id.localeCompare(b.id))

const categories = SHOT_CATEGORIES.map((row) => ({
  id: row.id,
  name: row.name,
  blurb: row.blurb,
  styles: row.styles,
  cards: rows.filter((entry) => entry.category === row.id).length,
}))

const payload = {
  upstream: SHOTS_UPSTREAM,
  gallery: SHOTS_GALLERY,
  license: 'Apache-2.0',
  commit,
  commitShort: commit ? commit.slice(0, 8) : '',
  posterAliases: POSTER_ALIAS,
  generated: new Date().toISOString().slice(0, 10),
  cards: rows.length,
  styles: categories.reduce((sum, row) => sum + row.styles, 0),
  categories,
  entries: rows,
}

const text = JSON.stringify(payload, null, 1) + '\n'

if (checkOnly) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    console.error('FAIL 索引不存在：' + OUT)
    process.exit(1)
  }
  const parsed = JSON.parse(current)
  const same = parsed.entries.length === payload.entries.length &&
    parsed.entries.every((entry, i) => entry.id === payload.entries[i].id && entry.title === payload.entries[i].title && entry.preview === payload.entries[i].preview)
  if (!same) {
    console.error('FAIL 索引和卡片不一致，跑一次 node tools/build-shots.mjs')
    process.exit(1)
  }
  console.log('PASS 索引与 ' + payload.entries.length + ' 张卡片一致（' + parsed.generated + ' 生成）')
  process.exit(0)
}

writeFileSync(OUT, text)
const posterCount = rows.filter((row) => row.preview).length
console.log(
  'wrote ' + SHOTS_CATALOG_REL + '：' + rows.length + ' 张卡 / ' + posterCount + ' 张 poster / ' +
  categories.length + ' 分类 / ' + payload.styles + ' 个镜头，' + (text.length / 1024).toFixed(0) + 'KB',
)
for (const row of categories) console.log('  ' + row.id.padEnd(12) + row.cards + ' 卡  ' + row.name)
