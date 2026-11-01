#!/usr/bin/env node
/**
 * dsh-anim-pack / tools/build-fx.mjs
 *
 * 从镜像进来的 patch-gg/pixelfx 仓库生成插件用的特效索引，并（可选）预渲染预览图。
 *
 *   node tools/build-fx.mjs                       # 只重建 assets/fx/catalog.json
 *   node tools/build-fx.mjs --previews            # 顺带把缺的预览图渲出来（每批 55 个）
 *   node tools/build-fx.mjs --previews --force    # 全部重渲
 *   node tools/build-fx.mjs --only fire/torch,ice/frost-nova --previews
 *   node tools/build-fx.mjs --repo D:/somewhere/pixelfx --out assets/fx
 *
 * 为什么索引是快照而不是运行时现算：宿主进程里不能 import 244 个特效模块
 * （那是别人的代码，跑起来还慢），所以这里一次性把 meta 读出来写成 JSON；
 * 之后插件只读 JSON + 源码文本 + 预览图。
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes('--' + name)

const REPO = resolve(flag('repo', join(ROOT, '..', '..', 'pixelfx')))
const OUT = resolve(flag('out', join(ROOT, 'assets', 'fx')))
const ZOOM = flag('zoom', '2')
const FRAMES = flag('frames', '10')
const BATCH = Number(flag('batch', '55'))
const ONLY = (flag('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const WANT_PREVIEWS = has('previews')
const FORCE = has('force')

const FX_DIR = join(REPO, 'src', 'fx')
if (!existsSync(FX_DIR)) {
  console.error('找不到 pixelfx 仓库：' + REPO)
  console.error('先 git clone https://github.com/patch-gg/pixelfx 到那里，或用 --repo 指定。')
  process.exit(1)
}

const run = (cmd, argv, opts = {}) => new Promise((res) => {
  execFile(cmd, argv, { windowsHide: true, maxBuffer: 16 << 20, ...opts }, (e, stdout, stderr) =>
    res({ code: e?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
})

const gitOr = (argv, fallback = '') => {
  try {
    return execFileSync('git', ['-C', REPO, ...argv], { encoding: 'utf8', windowsHide: true }).trim()
  } catch {
    return fallback
  }
}

const { categories } = await import(pathToFileURL(join(FX_DIR, 'categories.js')).href)
const catName = new Map(categories.map((c) => [c.id, c.name]))
const catIndex = new Map(categories.map((c, i) => [c.id, i]))

let version = ''
try {
  version = String(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version ?? '')
} catch {
  version = ''
}

const commit = gitOr(['rev-parse', 'HEAD'])
const commitShort = commit.slice(0, 7)
const upstream = 'https://github.com/patch-gg/pixelfx'

/** 枚举 src/fx/<category>/<effect>.js，跳过 index.js 与 _lib.js。 */
function allIds() {
  const ids = []
  for (const dir of readdirSync(FX_DIR)) {
    if (dir === 'index.js' || dir === 'categories.js') continue
    const full = join(FX_DIR, dir)
    if (!statSync(full).isDirectory()) continue
    for (const file of readdirSync(full)) {
      if (!file.endsWith('.js') || file === '_lib.js') continue
      ids.push(dir + '/' + file.replace(/\.js$/, ''))
    }
  }
  return ids.sort((a, b) =>
    (catIndex.get(a.split('/')[0]) ?? 99) - (catIndex.get(b.split('/')[0]) ?? 99) || a.localeCompare(b))
}

/** act 是「表演」数据：姿态关键帧 + 打击点。索引进只留看得懂的摘要。 */
function actSummary(act) {
  if (!act || typeof act !== 'object') return null
  const poses = Array.isArray(act.poses) ? act.poses : []
  const hits = Array.isArray(act.hits) ? act.hits : []
  return {
    target: act.target ?? null,
    poses: poses.length,
    windup: poses.length > 0 ? Math.abs(Number(poses[0][0]) || 0) : 0,
    hits: hits.map((hit) => ({
      t: hit.t,
      freeze: hit.freeze ?? 0,
      shake: hit.shake ?? 0,
      push: hit.push ?? 0,
      skin: hit.skin ?? null,
    })),
  }
}

const allWanted = ONLY.length > 0 ? ONLY : allIds()
const ids = allWanted.filter((id) => existsSync(join(FX_DIR, id + '.js')))
const entries = []
let failed = 0

for (const id of ids) {
  const rel = join('src', 'fx', id + '.js')
  const abs = join(REPO, rel)
  let mod
  try {
    mod = await import(pathToFileURL(abs).href)
  } catch (error) {
    failed += 1
    console.error('跳过 ' + id + '：' + String(error?.message ?? error).split('\n')[0])
    continue
  }
  const meta = mod.meta
  if (!meta) {
    failed += 1
    console.error('跳过 ' + id + '：没有导出 meta')
    continue
  }
  const text = readFileSync(abs, 'utf8')
  const [category] = id.split('/')
  entries.push({
    id,
    category,
    categoryName: catName.get(category) ?? category,
    name: meta.name,
    desc: meta.desc,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    size: Array.isArray(meta.size) ? meta.size : [0, 0],
    origin: Array.isArray(meta.origin) ? meta.origin : [0, 0],
    duration: meta.duration,
    fps: meta.fps,
    loop: Boolean(meta.loop),
    bg: meta.bg ?? '',
    actor: meta.actor ?? 0,
    options: meta.options ?? {},
    act: actSummary(mod.act),
    lib: /from\s+"\.\/_lib\.js"/.test(text) ? '_lib.js' : null,
    lines: text.split('\n').length,
    bytes: Buffer.byteLength(text),
    file: rel.split('\\').join('/'),
    source: upstream + '/blob/' + (commit || 'main') + '/' + rel.split('\\').join('/'),
    preview: null,
  })
}

const counts = new Map()
for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)

const previewDir = join(OUT, 'previews')
const previewOf = (id) => {
  const abs = join(previewDir, id, 'contact.png')
  return existsSync(abs) ? 'previews/' + id + '/contact.png' : null
}
for (const entry of entries) entry.preview = previewOf(entry.id)

// ── 预览图：调用仓库自己的 tools/render.mjs（接触表，zoom 2，每张 10 帧）──────
if (WANT_PREVIEWS) {
  const todo = entries.filter((entry) => FORCE || !entry.preview).map((entry) => entry.id)
  if (todo.length === 0) {
    console.log('预览图已是最新，跳过渲染（要重渲加 --force）')
  } else {
    console.log('渲染 ' + todo.length + ' 张预览图（zoom ' + ZOOM + ' / ' + FRAMES + ' 帧）…')
    const renderer = join(REPO, 'tools', 'render.mjs')
    const t0 = Date.now()
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH)
      const r = await run(process.execPath, [renderer, ...chunk, '--zoom', ZOOM, '--max', FRAMES, '--out', previewDir], {
        cwd: REPO,
        timeout: 600000,
      })
      if (r.code !== 0) console.error('渲染批次失败（' + chunk[0] + '…）：' + r.stderr.slice(0, 400))
      console.log('  ' + Math.min(i + BATCH, todo.length) + '/' + todo.length + '  已用 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's')
    }
    for (const entry of entries) entry.preview = previewOf(entry.id)
  }
}

const catalog = {
  generated: new Date().toISOString(),
  generator: 'tools/build-fx.mjs',
  // 相对插件根写进索引：镜像搬走 / 换机器后依然能解析（绝对路径运行时再拼）。
  repo: relative(ROOT, REPO).replace(/\\/g, '/'),
  upstream,
  version,
  commit,
  commitShort,
  license: 'MIT (code and effects; the gallery font is Patch (c) 2026, all rights reserved)',
  total: entries.length,
  withPreview: entries.filter((entry) => entry.preview).length,
  categories: categories
    .filter((c) => counts.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, blurb: c.blurb, count: counts.get(c.id) })),
  entries,
}

mkdirSync(OUT, { recursive: true })
const catalogPath = join(OUT, 'catalog.json')
writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n')

const size = statSync(catalogPath).size
console.log(
  entries.length + ' 个特效 → ' + catalogPath + '（' + (size / 1024).toFixed(0) + ' KB，' +
  catalog.categories.length + ' 个分类，' + catalog.withPreview + ' 张预览，提交 ' + (commitShort || '?') + '）',
)
if (failed > 0) {
  console.error(failed + ' 个特效读取失败')
  process.exit(1)
}
