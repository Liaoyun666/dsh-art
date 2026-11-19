#!/usr/bin/env node
/**
 * dsh-anim-pack 冒烟测试：不启动 DSH，直接用 node 验证 lib/catalog.js 的行为。
 *
 *   node tools/verify.mjs
 *
 * 检查项：素材库完整性（341 条索引 / 341 个提示词文件 / 193 张静帧真的在磁盘上）、
 * 编号查找、关键词与系列检索、读提示词、导出到临时目录、拒绝写进库内部，
 * 第二个数据源（自建美术素材库）客户端的离线单测，第三个数据源
 * （镜像进来的 patch-gg/pixelfx：244 个特效）的索引、查找、导出与真渲染，
 * 以及第四个数据源（本地元素提取）的解码、分割、裁剪、提示词与工具入口，
 * 第五个数据源（video-shotcraft 镜头卡）与前端设计路由 anim_design_brief 的选型逻辑，
 * 以及第六个数据源（设计工艺库：八锚点 / 24 条 CSS 模式 / 15 条审查准则 / 规则集）。
 * 全部通过打印 PASS，有任何一条不过就以退出码 1 结束。
 *
 *   node tools/verify.mjs --refs     额外跑联网检查：真的去素材库搜图、取详情、下载一张图。
 *                                    地址取 DSH_REF_BASE / config.refBase；不联网时不要加。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clampLimit,
  exportEntry,
  getEntry,
  loadCatalog,
  randomEntry,
  readPrompt,
  searchEntries,
  stillPath,
  summarize,
} from '../lib/catalog.js'

import {
  DEFAULT_REF_BASE,
  describeRef,
  normalizeRefConfig,
  refFileName,
  refUrl,
} from '../lib/refs.js'

import {
  exportFx,
  fxPreviewPath,
  fxSourcePath,
  fxStats,
  fxUsage,
  loadFxCatalog,
  randomFx,
  resolveFx,
  searchFx,
  summarizeFx,
} from '../lib/fx.js'

import {
  DESIGN_FILES,
  PATTERN_CATEGORIES,
  auditChecklist,
  loadDesignLibrary,
  resolveAnchor,
  searchPatterns,
} from '../lib/design.js'

import {
  decodeImage,
  encodePng,
  loadImage,
} from '../lib/image.js'

import { describeColor } from '../lib/vision.js'

import { buildBrief } from '../lib/prompt.js'

import {
  SHOT_CATEGORIES,
  exportShots,
  loadShotCatalog,
  parseShotCard,
  readShotCard,
  resolveShot,
  searchShots,
  shotPreviewPath,
  shotStats,
} from '../lib/shots.js'

import {
  canvas,
  contactSheet,
  extract,
  upscaleNearest,
} from '../lib/extract.js'

import {
  buildDesignBrief as buildDesignBriefPure,
  resolveSurface,
  tokensOf,
} from '../lib/brief.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED_TOTAL = 341
const EXPECTED_WITH_STILL = 193
const EXPECTED_SERIES = 10
const EXPECTED_FX_TOTAL = 244
const EXPECTED_FX_CATEGORIES = 21

let passed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    return
  }
  failures.push(detail ? `${label} —— ${detail}` : label)
}

const catalog = loadCatalog(ROOT)

// ── 索引本身 ────────────────────────────────────────────────────────────────
check('总条目数 = 341', catalog.total === EXPECTED_TOTAL, `实际 ${catalog.total}`)
check('索引条目数 = total', catalog.entries.length === EXPECTED_TOTAL, `实际 ${catalog.entries.length}`)
check('带静帧 = 193', catalog.withStill === EXPECTED_WITH_STILL, `实际 ${catalog.withStill}`)
check('系列数 = 10', catalog.series.length === EXPECTED_SERIES, `实际 ${catalog.series.length}`)
check(
  '系列条目数之和 = 341',
  catalog.series.reduce((sum, row) => sum + Number(row.count ?? 0), 0) === EXPECTED_TOTAL,
  catalog.series.map((row) => `${row.id}:${row.count}`).join(' '),
)

// ── 每个条目引用的文件都得真的存在 ─────────────────────────────────────────
const missingPrompts = catalog.entries.filter((entry) => !entry.filePath || !existsSync(entry.filePath))
check('341 个提示词文件都在磁盘上', missingPrompts.length === 0, `缺 ${missingPrompts.length} 个：${missingPrompts.slice(0, 5).map((e) => e.id).join(', ')}`)

const withImage = catalog.entries.filter((entry) => entry.imagePath)
check('193 条索引带静帧路径', withImage.length === EXPECTED_WITH_STILL, `实际 ${withImage.length}`)
const missingStills = withImage.filter((entry) => !existsSync(entry.imagePath))
check('193 张静帧都在磁盘上', missingStills.length === 0, `缺 ${missingStills.length} 张：${missingStills.slice(0, 5).map((e) => e.id).join(', ')}`)

const promptDirs = readdirSync(join(ROOT, 'assets', 'library', '风格提示词'))
check('素材库按系列分 10 个目录', promptDirs.length === EXPECTED_SERIES, `实际 ${promptDirs.length}：${promptDirs.join(', ')}`)
check('提示词目录里没有空目录', promptDirs.every((dir) => readdirSync(join(ROOT, 'assets', 'library', '风格提示词', dir)).length > 0))

// ── 单条读取 ───────────────────────────────────────────────────────────────
const first = catalog.entries[0]
check('getEntry 命中首条', getEntry(catalog, first.id)?.id === first.id)
check('getEntry 大小写不敏感', getEntry(catalog, first.id.toLowerCase())?.id === first.id)
check('getEntry 容忍首尾空格', getEntry(catalog, ` ${first.id} `)?.id === first.id)
check('getEntry 未知编号返回 null', getEntry(catalog, 'ZZ99') === null)

const prompt = readPrompt(first)
check('readPrompt 有内容', prompt.length > 200, `只有 ${prompt.length} 字符`)
check('readPrompt 是 Markdown', prompt.includes('#') || prompt.includes('：'), prompt.slice(0, 60).replace(/\n/g, ' '))

const summary = summarize(first)
check('summarize 字段齐全', ['id', 'name', 'series', 'description', 'fit', 'tags', 'hasStill'].every((key) => key in summary))
check('hasStill 与 imagePath 一致', summary.hasStill === Boolean(first.imagePath))

const withStillEntry = withImage[0]
check('stillPath 返回存在的图片', withStillEntry ? existsSync(stillPath(withStillEntry)) : false)
const textOnly = catalog.entries.find((entry) => !entry.imagePath)
check('文字参考条目 stillPath 为空串', textOnly ? stillPath(textOnly) === '' : false)

// ── 检索 ───────────────────────────────────────────────────────────────────
const byId = searchEntries(catalog, { query: first.id, limit: 5 })
check('按编号检索把该条排第一', byId[0]?.id === first.id, `实际 ${byId[0]?.id}`)

const seriesId = catalog.series[0].id
const inSeries = searchEntries(catalog, { series: seriesId, limit: 200 })
check('系列筛选只返回该系列', inSeries.length > 0 && inSeries.every((entry) => entry.series === seriesId))
check('系列筛选条数与索引一致', inSeries.length === catalog.series[0].count, `实际 ${inSeries.length} / 索引 ${catalog.series[0].count}`)

const word = first.name.slice(0, 2)
const byWord = searchEntries(catalog, { query: word, limit: 50 })
check('关键词检索有结果', byWord.length > 0, `关键词「${word}」没有结果`)
check('关键词结果确实包含该词', byWord.every((entry) => JSON.stringify(summarize(entry)).toLowerCase().includes(word.toLowerCase())))

const multi = searchEntries(catalog, { query: `${word} ${first.series}`, limit: 50 })
check('多词是 AND 关系', multi.length > 0 && multi.length <= byWord.length, `${multi.length} / ${byWord.length}`)

check('未知系列返回空数组', searchEntries(catalog, { series: 'ZZ' }).length === 0)
check('未知关键词返回空数组', searchEntries(catalog, { query: '这个词库里绝对没有出现过吧' }).length === 0)
check('limit 生效', searchEntries(catalog, { limit: 3 }).length === 3)
check('clampLimit 兜住非法值', clampLimit('abc') === 20 && clampLimit(-5) === 20 && clampLimit(9999) === 200 && clampLimit(0, 7) === 7)

// ── 随机 ───────────────────────────────────────────────────────────────────
const picked = new Set()
for (let i = 0; i < 30; i += 1) picked.add(randomEntry(catalog).id)
check('randomEntry 有随机性', picked.size > 1, `30 次只抽到 ${picked.size} 个`)
check('randomEntry 系列筛选正确', catalog.entries.length > 0 && randomEntry(catalog, { series: seriesId })?.series === seriesId)
check('randomEntry 未知系列返回 null', randomEntry(catalog, { series: 'ZZ' }) === null)

// ── 导出 ───────────────────────────────────────────────────────────────────
const workDir = mkdtempSync(join(tmpdir(), 'anim-pack-verify-'))
try {
  const ok = exportEntry(catalog, withStillEntry ?? first, join(workDir, 'one'))
  check('导出成功', ok.ok === true, ok.error)
  check('导出后提示词落地', ok.ok === true && existsSync(ok.files[0]) && statSync(ok.files[0]).size > 200)
  if (withStillEntry) {
    check('导出带上静帧', ok.ok === true && ok.files.length === 2 && existsSync(ok.files[1]))
  }

  const inside = exportEntry(catalog, first, join(catalog.root, 'assets', 'library', '风格提示词'))
  check('拒绝写进库内部', inside.ok === false && /refusing/.test(inside.error ?? ''), JSON.stringify(inside))

  const same = exportEntry(catalog, first, catalog.root)
  check('拒绝写进库根目录', same.ok === false, JSON.stringify(same))
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

// ── 第二个数据源：素材库客户端（纯离线单测，不碰网络）─────────────────────
const refDefaults = normalizeRefConfig({})
check('refBase 默认值 = DEFAULT_REF_BASE（配置/环境变量可覆盖）', refDefaults.base === DEFAULT_REF_BASE, refDefaults.base)
check('默认 refBase 是占位地址，不写死私人服务器',
  /^(127[.]0[.]0[.]1|localhost)$/.test(new URL(DEFAULT_REF_BASE).hostname) || Boolean(process.env.DSH_REF_BASE),
  DEFAULT_REF_BASE)
check('refTimeoutMs 默认 20s', refDefaults.timeoutMs === 20000, String(refDefaults.timeoutMs))
check('refCacheDir 默认落在 ~/.dsh/cache/anim-pack-refs', /cache[\\/]anim-pack-refs$/.test(refDefaults.cacheDir), refDefaults.cacheDir)

const refTuned = normalizeRefConfig({ refBase: ' http://10.0.0.2:8080/ ', refTimeoutMs: 10, refCacheDir: ' D:/tmp/refs ' })
check('refBase 去掉尾部斜杠与空格', refTuned.base === 'http://10.0.0.2:8080', refTuned.base)
check('refTimeoutMs 有下限（不会 10ms 就把请求判死）', refTuned.timeoutMs === 2000, String(refTuned.timeoutMs))
check('refCacheDir 可覆盖', refTuned.cacheDir === 'D:/tmp/refs', refTuned.cacheDir)

const builtUrl = new URL(refUrl('http://h:1/', '/api/refs/search', { q: '水墨 x', limit: 3, skip: '' }))
check('refUrl 拼出正确路径', builtUrl.pathname === '/api/refs/search', builtUrl.pathname)
check('refUrl 保留中文并编码', builtUrl.searchParams.get('q') === '水墨 x', String(builtUrl.searchParams.get('q')))
check('refUrl 丢掉空参数', builtUrl.searchParams.has('skip') === false && builtUrl.searchParams.get('limit') === '3', builtUrl.search)
check('refUrl 不会拼出重复斜杠', new URL(refUrl('http://h:1', 'api/refs/stats')).pathname === '/api/refs/stats')

check('refFileName 用 id + 标题 + 尺寸命名',
  refFileName({ id: 'met_102715', title: 'Wallet' }, 'orig', 'http://x/library/met/102715/orig.jpg') === 'met_102715__wallet__orig.jpg',
  refFileName({ id: 'met_102715', title: 'Wallet' }, 'orig', 'http://x/library/met/102715/orig.jpg'))
check('refFileName 洗掉标题里的斜杠',
  refFileName({ id: 'a_1', title: '1boy / amputee' }, 'small', 'http://x/a/w560.webp') === 'a_1__1boy-amputee__small.webp',
  refFileName({ id: 'a_1', title: '1boy / amputee' }, 'small', 'http://x/a/w560.webp'))
check('refFileName 没有扩展名时按尺寸兜底',
  refFileName({ id: 'lospec_x', title: '' }, 'thumb', 'http://x/weird').endsWith('__thumb.webp'),
  refFileName({ id: 'lospec_x', title: '' }, 'thumb', 'http://x/weird'))

const sampleItem = {
  id: 'met_102715', title: 'Wallet', creator: 'German', date: 'ca. 1830',
  categoryLabel: '纺织 · 织物', license: 'CC0 1.0 / Public Domain', sourceName: '大都会博物馆',
  w: 600, h: 454, bytes: 72198, palette: ['#a47234', '#332d1f'],
  page: 'https://www.metmuseum.org/art/collection/search/102715',
  urls: { orig: 'https://example.org/library/met/102715/orig.jpg' },
}
const described = describeRef(sampleItem, { index: 1 })
check('describeRef 带编号与标题', described.includes('met_102715') && described.includes('Wallet'), described.slice(0, 60))
check('describeRef 带授权与来源页', described.includes('CC0') && described.includes('metmuseum.org'))
check('describeRef 带尺寸与原图地址', described.includes('600×454') && described.includes('orig.jpg'))

// ── 第三个数据源：pixelfx 特效库（索引 / 查找 / 检索 / 导出）─────────────────
const fx = loadFxCatalog(ROOT)
check('特效索引 244 条', fx.total === EXPECTED_FX_TOTAL && fx.entries.length === EXPECTED_FX_TOTAL, `实际 ${fx.total} / ${fx.entries.length}`)
check('特效分类 21 个', fx.categories.length === EXPECTED_FX_CATEGORIES, fx.categories.map((row) => row.id).join(','))
check('分类条目数之和 = 244', fx.categories.reduce((sum, row) => sum + row.count, 0) === EXPECTED_FX_TOTAL)
check('每条 id 都是 <分类>/<名字>', fx.entries.every((entry) => /^[a-z]+\/[a-z0-9-]+$/.test(entry.id)), fx.entries.find((e) => !/^[a-z]+\/[a-z0-9-]+$/.test(e.id))?.id ?? '')
check('每条都写了描述与标签', fx.entries.every((entry) => typeof entry.desc === 'string' && entry.desc.length > 20 && entry.tags.length > 0))
check('索引记了上游提交号', /^[0-9a-f]{7,}$/.test(fx.commit), fx.commit)

const previews = fx.entries.filter((entry) => fxPreviewPath(entry))
check('244 张预览接触表都在磁盘上', previews.length === EXPECTED_FX_TOTAL, `实际 ${previews.length}`)

const fxSummaryStats = fxStats(fx)
check('fxStats 的循环 + 单次 = 总数', fxSummaryStats.loops + fxSummaryStats.oneShots === fx.total, JSON.stringify({ loops: fxSummaryStats.loops, oneShots: fxSummaryStats.oneShots }))
check('fxStats 有分类明细与像素范围', fxSummaryStats.categories.length === EXPECTED_FX_CATEGORIES && fxSummaryStats.pixels.max > fxSummaryStats.pixels.min)

const fxEntry = fx.byId.get('fire/torch')
check('resolveFx 按完整 id 命中', resolveFx(fx, 'fire/torch').kind === 'exact')
const suffixed = resolveFx(fx, 'FIRE/Torch.js')
check('resolveFx 容忍 .js 后缀与大小写', suffixed.entry?.id === 'fire/torch', suffixed.entry?.id ?? suffixed.kind)
check('resolveFx 只给名字也能命中', ['exact', 'loose'].includes(resolveFx(fx, 'torch').kind), resolveFx(fx, 'torch').kind)
check('resolveFx 未知返回 missing', resolveFx(fx, 'no/such-effect').kind === 'missing')
const dupeSlug = fx.entries.find((entry) => (fx.bySlug.get(entry.id.split('/')[1]) ?? []).length > 1)
if (dupeSlug) {
  const ambiguous = resolveFx(fx, dupeSlug.id.split('/')[1])
  check('同名特效判为 ambiguous 并给出候选', ambiguous.kind === 'ambiguous' && ambiguous.candidates.length > 1, `${ambiguous.kind} ${ambiguous.candidates.length}`)
}

const fxCard = summarizeFx(fxEntry)
check('summarizeFx 字段齐全', ['id', 'name', 'category', 'tags', 'size', 'duration', 'fps', 'loop', 'actor', 'acted', 'hasPreview', 'desc'].every((key) => key in fxCard))
check('summarizeFx 预览标记为真', fxCard.hasPreview === true)

const fireHits = searchFx(fx, { category: 'fire', limit: 200 })
check('分类筛选只返回该分类', fireHits.length > 0 && fireHits.every((entry) => entry.category === 'fire'), String(fireHits.length))
check('分类筛选条数与索引一致', fireHits.length === fx.categories.find((row) => row.id === 'fire').count)
const torchHits = searchFx(fx, { query: 'torch' })
check('关键词检索命中 fire/torch', torchHits.some((entry) => entry.id === 'fire/torch'))
const loopHits = searchFx(fx, { loop: 'loop', limit: 200 })
check('loop 筛选生效', loopHits.length > 0 && loopHits.every((entry) => entry.loop), String(loopHits.length))
const onceHits = searchFx(fx, { loop: 'once', limit: 200 })
check('once 筛选生效', onceHits.length > 0 && onceHits.every((entry) => !entry.loop), String(onceHits.length))
const actorHits = searchFx(fx, { actor: true, limit: 200 })
check('actor 筛选生效', actorHits.length > 0 && actorHits.every((entry) => entry.actor), String(actorHits.length))
check('未知分类返回空', searchFx(fx, { category: 'nope' }).length === 0)
check('未知关键词返回空', searchFx(fx, { query: '这个词在特效库里不存在' }).length === 0)

const fxPicks = new Set()
for (let i = 0; i < 20; i += 1) fxPicks.add(randomFx(fx).id)
check('randomFx 有随机性', fxPicks.size > 1, `20 次只抽到 ${fxPicks.size} 个`)
check('randomFx 分类筛选正确', randomFx(fx, { category: 'ui' })?.category === 'ui')

check('fxUsage 给出可粘贴的接入代码', /createFx/.test(fxUsage(fxEntry)) && /composite/.test(fxUsage(fxEntry)))

const mirror = Boolean(fx.repo && existsSync(fx.repo))
if (!mirror) console.log('（提示：pixelfx 镜像不在 ' + (fx.repo || '?') + '，跳过源码与真渲染检查）')
if (mirror) {
  const missingFxSource = fx.entries.filter((entry) => !fxSourcePath(entry))
  check('244 个特效源码都在镜像里', missingFxSource.length === 0, missingFxSource.slice(0, 5).map((entry) => entry.id).join(', '))
}

const fxWorkDir = mkdtempSync(join(tmpdir(), 'anim-pack-fx-'))
try {
  const target = fxEntry ?? fx.entries[0]
  const exported = exportFx(fx, [target], { dir: join(fxWorkDir, 'out') })
  if (mirror) {
    check('exportFx 逻辑导出成功', exported.ok === true, exported.error ?? '')
    check(
      '导出落地证件（package.json / core / 渲染工具 / 许可）',
      existsSync(join(fxWorkDir, 'out', 'package.json')) &&
        existsSync(join(fxWorkDir, 'out', 'src', 'core', 'index.js')) &&
        existsSync(join(fxWorkDir, 'out', 'tools', 'render.mjs')) &&
        existsSync(join(fxWorkDir, 'out', 'LICENSE')),
      String(exported.error ?? ''),
    )
  } else {
    // 没有镜像（公开仓和 CI 的常态）：导出要给人话，不能崩，也不能假装成功。
    const reason = (exported.ids ?? []).map((row) => row.error).filter(Boolean).join(' ') || String(exported.error ?? '')
    check('镜像缺席时导出说清楚原因', exported.ok === false && /missing in the mirror/.test(reason), reason.slice(0, 160))
  }
  if (mirror) {
    const image = join(fxWorkDir, 'out', 'records', target.id, 'contact.png')
    try {
      execFileSync(process.execPath, [join(fxWorkDir, 'out', 'tools', 'render.mjs'), target.id, '--zoom', '1', '--max', '6'], {
        cwd: join(fxWorkDir, 'out'),
        stdio: 'ignore',
        timeout: 180000,
      })
      check('导出的小项目真的能渲染出接触表', existsSync(image) && statSync(image).size > 1000, image)
    } catch (error) {
      check('导出的小项目真的能渲染出接触表', false, String(error?.message ?? error).slice(0, 200))
    }
  }
  const intoPlugin = exportFx(fx, [target], { dir: join(ROOT, 'assets', 'fx') })
  check('拒绝把特效导进插件 assets', intoPlugin.ok === false && /refusing/.test(intoPlugin.error ?? ''), String(intoPlugin.error ?? ''))
  if (mirror) {
    const intoMirror = exportFx(fx, [target], { dir: join(fx.repo, 'records') })
    check('拒绝把特效导进 pixelfx 镜像', intoMirror.ok === false && /refusing/.test(intoMirror.error ?? ''), String(intoMirror.error ?? ''))
  }
} finally {
  rmSync(fxWorkDir, { recursive: true, force: true })
}

// ── 插件注册：用假 ctx 跑一遍 apply()，31 个工具都得能真的执行 ─────────────
const registered = []
const fakeCtx = { tools: { register: (tool) => registered.push(tool) }, logger: { info: () => {} } }
const { apply } = await import('../lib/index.js')
apply(fakeCtx, {})

const TOOL_NAMES = [
  'anim_design_brief', 'anim_design_anchors', 'anim_design_patterns', 'anim_design_audit',
  'anim_list_series', 'anim_search', 'anim_show', 'anim_still', 'anim_export', 'anim_random', 'anim_guide',
  'anim_ref_sources', 'anim_ref_search', 'anim_ref_show', 'anim_ref_pick',
  'anim_fx_stats', 'anim_fx_search', 'anim_fx_show', 'anim_fx_preview', 'anim_fx_export', 'anim_fx_random', 'anim_fx_guide',
  'anim_extract', 'anim_extract_guide',
  'anim_shot_stats', 'anim_shot_search', 'anim_shot_show', 'anim_shot_preview',
  'anim_shot_export', 'anim_shot_random', 'anim_shot_guide',
]
const toolsByName = new Map(registered.map((tool) => [tool.name, tool]))
check('注册了 31 个工具', registered.length === TOOL_NAMES.length, `实际 ${registered.length}：${registered.map((t) => t.name).join(', ')}`)
check('工具名齐全', TOOL_NAMES.every((name) => toolsByName.has(name)), TOOL_NAMES.filter((n) => !toolsByName.has(n)).join(', '))
check(
  '每个工具都有描述与 JSON Schema',
  registered.every((tool) => typeof tool.description === 'string' && tool.description.length > 5 && tool.parameters?.type === 'object'),
)
check('输出 renderer 返回 text 块', registered.every((tool) => {
  const blocks = tool.output.render({}, 'hello')
  return Array.isArray(blocks) && blocks[0]?.type === 'text' && blocks[0]?.text === 'hello'
}))

const callTool = (name, args = {}, exec = {}) => toolsByName.get(name).execute(args, exec)

const listOut = JSON.parse(await callTool('anim_list_series'))
check('anim_list_series 给出 10 个系列 / 341 条', listOut.series.length === 10 && listOut.total === 341, JSON.stringify(listOut).slice(0, 120))

const searchOut = JSON.parse(await callTool('anim_search', { query: first.id, limit: 5 }))
check('anim_search 命中该条', searchOut.results[0]?.id === first.id, JSON.stringify(searchOut.results[0] ?? null))

const showOut = await callTool('anim_show', { id: first.id.toLowerCase() })
check('anim_show 输出元信息 + 提示词正文', showOut.includes(`# ${first.id} ${first.name}`) && showOut.length > 500, `${showOut.length} 字符`)
check('anim_show 未知编号给提示而不是抛错', (await callTool('anim_show', { id: 'ZZ99' })).includes('找不到'))

const stillOut = await callTool('anim_still', { id: withStillEntry.id })
check('anim_still 给出存在的图片路径', existsSync(stillOut.trim().split('\n').pop() ?? ''), stillOut.slice(0, 120))
check('anim_still 文字参考条目说明没有图', (await callTool('anim_still', { id: textOnly.id })).includes('没有参考静帧'))

const guideOut = await callTool('anim_guide')
check('anim_guide 读到制作指南', guideOut.length > 1000, `${guideOut.length} 字符`)

const toolWorkDir = mkdtempSync(join(tmpdir(), 'anim-pack-tools-'))
try {
  const exportOut = JSON.parse(await callTool('anim_export', { ids: [first.id, withStillEntry.id], dir: join(toolWorkDir, 'out') }))
  check('anim_export 两条都导出成功', exportOut.results.every((row) => row.ok === true), JSON.stringify(exportOut.results))
  check('anim_export 落地的文件真的存在', exportOut.results.every((row) => row.files.every((file) => existsSync(file))))
  const emptyOut = await callTool('anim_export', {})
  check('anim_export 没给编号时给提示', emptyOut.includes('没有给出'))
} finally {
  rmSync(toolWorkDir, { recursive: true, force: true })
}

const randomOut = await callTool('anim_random', { series: seriesId })
check('anim_random 限定系列', randomOut.includes(`系列：${seriesId}`), randomOut.slice(0, 80))

// ── 素材库工具：网络不通时必须给一句人话，而不是抛异常 ─────────────────────
const offlineRegistered = []
const offlineCtx = { tools: { register: (tool) => offlineRegistered.push(tool) }, logger: { info: () => {} } }
apply(offlineCtx, { refBase: 'http://127.0.0.1:9', refTimeoutMs: 2000 })
const offlineTools = new Map(offlineRegistered.map((tool) => [tool.name, tool]))
const offlineSources = await offlineTools.get('anim_ref_sources').execute({}, {})
check('素材库连不上时 anim_ref_sources 给提示而不是抛错', typeof offlineSources === 'string' && offlineSources.includes('没连上'), String(offlineSources).slice(0, 80))
const offlineSearch = await offlineTools.get('anim_ref_search').execute({ query: '水墨' }, {})
check('素材库连不上时 anim_ref_search 同样给文本提示', typeof offlineSearch === 'string' && offlineSearch.includes('没连上'), String(offlineSearch).slice(0, 80))

// ── 特效工具：还是那个假 ctx，7 条工具都得真的跑出人话 ─────────────────────
const fxStatsOut = JSON.parse(await callTool('anim_fx_stats'))
check('anim_fx_stats 报出 244 个特效 / 21 个分类', fxStatsOut.total === EXPECTED_FX_TOTAL && fxStatsOut.categories.length === EXPECTED_FX_CATEGORIES, JSON.stringify({ total: fxStatsOut.total, categories: fxStatsOut.categories?.length }))

const fxSearchOut = JSON.parse(await callTool('anim_fx_search', { query: 'torch', limit: 5 }))
check('anim_fx_search 关键词命中 fire/torch', fxSearchOut.results.some((row) => row.id === 'fire/torch'), JSON.stringify(fxSearchOut.results.slice(0, 2)))

const fxShowOut = await callTool('anim_fx_show', { id: 'fire/torch' })
check('anim_fx_show 输出元信息 + 接入代码', fxShowOut.includes('# fire/torch') && fxShowOut.includes('createFx'), fxShowOut.slice(0, 80))
check('anim_fx_show 未知 id 给提示而不是抛错', (await callTool('anim_fx_show', { id: 'no/such-effect' })).includes('找不到特效'))
const fxSourceOut = await callTool('anim_fx_show', { id: 'fire/torch', source: true })
check('anim_fx_show source=true 附源码', fxSourceOut.includes('## 源码') && fxSourceOut.length > fxShowOut.length, `${fxSourceOut.length} / ${fxShowOut.length}`)

const fxPreviewOut = await callTool('anim_fx_preview', { id: 'fire/torch' })
// 别用「盘符」正则认路径：CI 跑在 Linux 上，只有 /home/... 这种；直接拿拼好的绝对路径比对更稳。
const fxPreviewAbs = resolve(ROOT, 'assets', 'fx', 'previews', 'fire', 'torch', 'contact.png')
check(
  'anim_fx_preview 给出存在的 PNG 路径',
  fxPreviewOut.includes(fxPreviewAbs) && existsSync(fxPreviewAbs),
  fxPreviewOut.slice(0, 160),
)
check('anim_fx_preview 没给 id 时给提示', (await callTool('anim_fx_preview', {})).includes('给一个 id'))

const fxToolDir = mkdtempSync(join(tmpdir(), 'anim-pack-fxtool-'))
try {
  const fxExportOut = JSON.parse(await callTool('anim_fx_export', { ids: ['fire/torch', 'ui/level-up'], dir: join(fxToolDir, 'game') }))
  check('anim_fx_export 没给 id 时给提示', (await callTool('anim_fx_export', {})).includes('没有给出要导出的特效'))
  if (mirror) {
    check('anim_fx_export 两个特效都落地', fxExportOut.count === 2 && fxExportOut.effects.every((row) => row.ok), JSON.stringify(fxExportOut.effects))
    check('anim_fx_export 给了下一步命令', Array.isArray(fxExportOut.next) && fxExportOut.next.some((line) => line.includes('--sheet')))
    const fxCatOut = JSON.parse(await callTool('anim_fx_export', { category: 'ui', dir: join(fxToolDir, 'ui-only') }))
    check('anim_fx_export 按分类批量导出', fxCatOut.count > 0 && fxCatOut.effects.every((row) => row.id.startsWith('ui/')), JSON.stringify({ count: fxCatOut.count }))
  } else {
    check('anim_fx_export 镜像缺席时逐条报原因', fxExportOut.count === 0 && fxExportOut.effects.every((row) => row.ok === false), JSON.stringify(fxExportOut.effects).slice(0, 160))
  }
} finally {
  rmSync(fxToolDir, { recursive: true, force: true })
}

const fxRandomOut = await callTool('anim_fx_random', { category: 'ui' })
check('anim_fx_random 限定分类', fxRandomOut.startsWith('# ui/'), fxRandomOut.slice(0, 60))

const fxGuideOut = await callTool('anim_fx_guide')
check('anim_fx_guide 读到特效指南', fxGuideOut.length > 2000 && fxGuideOut.includes('anim_fx_search'), `${fxGuideOut.length} 字符`)

// ── 第四个数据源：元素提取（解码 / 分析 / 裁剪 / 提示词 / 工具）──────────────
const exDir = mkdtempSync(join(tmpdir(), 'anim-pack-extract-'))
try {
  // 1) 编码 → 解码往返：PNG 这条路要是错的，后面全错
  const scene = canvas(96, 54, [52, 64, 94, 255])
  for (let y = 0; y < 54; y++) {
    for (let x = 0; x < 96; x++) {
      const o = (y * 96 + x) * 4
      if (y >= 32) {
        // 地面：暗绿，压暗一点让它和天空分开
        scene.data[o] = 46; scene.data[o + 1] = 62; scene.data[o + 2] = 40; scene.data[o + 3] = 255
      }
    }
  }
  // 主体：靠下的红色竖块（12% 画布左右的「角色」）
  for (let y = 14; y < 50; y++) {
    for (let x = 38; x < 56; x++) {
      const o = (y * 96 + x) * 4
      scene.data[o] = 196; scene.data[o + 1] = 62; scene.data[o + 2] = 44; scene.data[o + 3] = 255
    }
  }
  // 文字条：左上角三条白线
  for (let i = 0; i < 3; i++) {
    for (let x = 5; x < 34 - i * 6; x++) {
      const o = ((5 + i * 4) * 96 + x) * 4
      scene.data[o] = 238; scene.data[o + 1] = 242; scene.data[o + 2] = 250; scene.data[o + 3] = 255
    }
  }
  const pngBytes = encodePng(scene, { level: 6 })
  const decoded = decodeImage(pngBytes, 'png')
  check('encodePng → decodeImage 往返尺寸一致', decoded.width === 96 && decoded.height === 54, decoded.width + 'x' + decoded.height)
  let worst = 0
  for (let i = 0; i < 96 * 54; i++) {
    for (let c = 0; c < 4; c++) {
      worst = Math.max(worst, Math.abs(scene.data[i * 4 + c] - decoded.data[i * 4 + c]))
    }
  }
  check('encodePng → decodeImage 往返像素无损', worst === 0, 'worst=' + worst)

  // 2) 颜色命名：不能把「橙」拼成「灰橙」（zh 初值泄漏的老 bug）
  const orange = describeColor(164, 127, 71)
  check('describeColor 的色相名不带多余「灰」', orange.zh === '橙', orange.zh)
  check('describeColor 灰阶仍叫「灰」', describeColor(128, 128, 128).zh.startsWith('灰'))
  check('describeColor 低饱和带「灰调」前缀', describeColor(96, 104, 120).zh.startsWith('灰调'), describeColor(96, 104, 120).zh)

  // 3) 合成场景 → extract()
  const scenePath = join(exDir, 'scene.png')
  writeFileSync(scenePath, pngBytes)
  const sceneResult = extract(scenePath, { out: join(exDir, 'out-scene'), top: 4 })
  check('extract 认出这是场景图', sceneResult.kind === 'scene', sceneResult.kind)
  check('extract 算出背景占比（55%~98%）', sceneResult.background.share > 0.55 && sceneResult.background.share < 0.98, String(sceneResult.background.share))
  check('extract 分出至少 2 个元素', sceneResult.elements.length >= 2, String(sceneResult.elements.length))
  const hero = sceneResult.elements.find((e) => e.role === 'character')
  check('extract 把红色竖块认成主体', Boolean(hero), JSON.stringify(sceneResult.elements.map((e) => e.role)))
  check('主体的 bbox 落在画布中间偏下', hero ? hero.bbox.x >= 34 && hero.bbox.x <= 42 && hero.bbox.y + hero.bbox.h >= 40 : false, JSON.stringify(hero?.bbox ?? null))
  check('extract 落盘 report.md / brief.json / palette.png', ['report.md', 'brief.json', 'palette.png'].every((f) => existsSync(join(exDir, 'out-scene', f))))
  check('extract 裁剪块真的写出来了', sceneResult.crops.length >= 2 && sceneResult.crops.every((c) => existsSync(c.file)), String(sceneResult.crops.length))
  check('extract 有接触表', existsSync(join(exDir, 'out-scene', 'contact.png')))
  check('调色板 hex 都是 6 位', sceneResult.palette.every((p) => /^#[0-9a-f]{6}$/.test(p.hex)), JSON.stringify(sceneResult.palette.slice(0, 3)))
  check('调色板背景排最后', sceneResult.palette.at(-1)?.from === 'background', String(sceneResult.palette.at(-1)?.from))
  const reportText = readFileSync(join(exDir, 'out-scene', 'report.md'), 'utf8')
  const fgLine = reportText.match(/前景 \/ 背景：([\d.]+)% \/ ([\d.]+)%/)
  check('报告里前景 + 背景 = 100%', fgLine ? Math.abs(Number(fgLine[1]) + Number(fgLine[2]) - 100) < 0.4 : false, fgLine?.[0] ?? '')
  const fenceText = String.fromCharCode(96, 96, 96) + 'text'
  const fenceCount = reportText.split(fenceText).length - 1
  check('报告里有提示词段与两段代码块', reportText.includes('## 提示词') && fenceCount >= 2, String(fenceCount))
  check('生图提示词不是空壳', sceneResult.brief.imagePrompt.length > 60, String(sceneResult.brief.imagePrompt.length))
  check('特效提示词带 canvas 与 palette', /canvas: \d+x\d+/.test(sceneResult.brief.fxPrompt) && /palette: #/.test(sceneResult.brief.fxPrompt), sceneResult.brief.fxPrompt.split('\n').slice(0, 3).join(' | '))
  check('brief 里的元素不超过 top', sceneResult.brief.elements.length <= 4, String(sceneResult.brief.elements.length))

  // 4) 像素画：4 倍放大后应认出倍率 ×4 并按缩小后的尺寸分析
  // 源图要先有逐像素的细微差异：整片纯色的话，8×8 块也「同色」，倍率会判成 8。
  const artBase = canvas(96, 54, [0, 0, 0, 255])
  for (let i = 0; i < 96 * 54; i++) {
    const n = ((i * 37) % 7) - 3
    artBase.data[i * 4] = Math.max(0, Math.min(255, scene.data[i * 4] + n))
    artBase.data[i * 4 + 1] = Math.max(0, Math.min(255, scene.data[i * 4 + 1] + n))
    artBase.data[i * 4 + 2] = Math.max(0, Math.min(255, scene.data[i * 4 + 2] + n))
    artBase.data[i * 4 + 3] = 255
  }
  const big = upscaleNearest(artBase, 4)
  const artPath = join(exDir, 'scene-4x.png')
  writeFileSync(artPath, encodePng(big, { level: 6 }))
  const artResult = extract(artPath, { out: join(exDir, 'out-art'), top: 3 })
  check('像素画检测认出 ×4 倍率', Math.round(1 / artResult.scale) === 4, String(artResult.scale))
  check('像素画按原尺寸 / 4 分析', artResult.analysis.width === 96 && artResult.analysis.height === 54, artResult.analysis.width + 'x' + artResult.analysis.height)
  check('像素画也分得出主体', artResult.elements.some((e) => e.role === 'character'), JSON.stringify(artResult.elements.map((e) => e.role)))

  // 5) 无缝贴图：不裁元素块（整张都是「元素」，裁了没意义）
  const tile = canvas(48, 48, [40, 70, 48, 255])
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const o = (y * 48 + x) * 4
      const v = ((x * 7 + y * 13) % 17) * 6
      tile.data[o] = 40 + v; tile.data[o + 1] = 70 + v; tile.data[o + 2] = 48 + v; tile.data[o + 3] = 255
    }
  }
  // 把右边一列抄成左边一列、下边一行抄成上边一行，接缝才会是 0 → 判成可平铺
  for (let y = 0; y < 48; y++) {
    const l = (y * 48) * 4, r = (y * 48 + 47) * 4
    tile.data[l] = tile.data[r]; tile.data[l + 1] = tile.data[r + 1]; tile.data[l + 2] = tile.data[r + 2]
  }
  for (let x = 0; x < 48; x++) {
    const t0 = x * 4, b = (47 * 48 + x) * 4
    tile.data[t0] = tile.data[b]; tile.data[t0 + 1] = tile.data[b + 1]; tile.data[t0 + 2] = tile.data[b + 2]
  }
  const tilePath = join(exDir, 'tile.png')
  writeFileSync(tilePath, encodePng(tile, { level: 6 }))
  const tileResult = extract(tilePath, { out: join(exDir, 'out-tile') })
  if (tileResult.kind === 'texture') {
    check('贴图不裁元素块', tileResult.crops.length === 0, String(tileResult.crops.length))
    check('贴图不生成接触表（没东西可拼）', !existsSync(join(exDir, 'out-tile', 'contact.png')))
  } else {
    check('非贴图图仍按元素处理（合成贴图没被判成 texture，跳过裁剪断言）', true)
  }

  // 5b) 图片类型不能只看「背景占比高 + 元素都小」：远景风景图也是这付样子，
  //     曾经被判成精灵表，连带把角色改叫 sprite。精灵表的判据是「背景是一整块纯色」——
  //     四个角同色；风景图上面是天、下面是地，四角互差很大。
  const vista = canvas(96, 54, [86, 122, 166, 255])
  for (let y = 0; y < 54; y++) {
    for (let x = 0; x < 96; x++) {
      const o = (y * 96 + x) * 4
      if (y >= 30) { vista.data[o] = 78; vista.data[o + 1] = 102; vista.data[o + 2] = 56 }
      else if (y >= 22) { vista.data[o] = 52; vista.data[o + 1] = 74; vista.data[o + 2] = 62 }
    }
  }
  // 五块小石头：让「元素都小、数量又够」这条也成立，专门喂给老判据
  const rocks = [[6, 44, 170, 96, 60], [24, 47, 150, 84, 52], [48, 42, 196, 120, 70], [66, 46, 120, 96, 64], [82, 43, 210, 150, 90]]
  for (const [rx, ry, rr, rg, rb] of rocks) {
    for (let y = ry; y < ry + 6; y++) {
      for (let x = rx; x < rx + 8; x++) {
        const o = (y * 96 + x) * 4
        vista.data[o] = rr; vista.data[o + 1] = rg; vista.data[o + 2] = rb
      }
    }
  }
  const vistaPath = join(exDir, 'vista.png')
  writeFileSync(vistaPath, encodePng(vista, { level: 6 }))
  const vistaResult = extract(vistaPath, { out: join(exDir, 'out-vista'), top: 4 })
  check('远景风景图不会误判成精灵表（四角不同色）', vistaResult.kind === 'scene', vistaResult.kind)

  // 反过来：真正的精灵表是「一整块纯色底 + 一堆差不多大的小图」，必须还是 sprite-sheet
  // 尺寸特意不统一（8×11 / 9×10 / 8×12…）：整整齐齐的 6×8 会被像素画检测当成「3 倍放大」，
  // 一缩小元素就没了。每只在画布上约 1.7~1.9%，正好落在精灵表那档。
  const sheet = canvas(96, 54, [30, 34, 44, 255])
  const sprites = [[6, 8, 8, 11, 220, 60, 50], [26, 7, 9, 10, 60, 180, 220], [46, 9, 8, 12, 230, 200, 80],
    [6, 30, 7, 12, 140, 90, 220], [24, 31, 9, 11, 80, 210, 120], [46, 30, 8, 11, 240, 140, 60]]
  for (const [sx, sy, sw, sh, sr, sg, sb] of sprites) {
    for (let y = sy; y < sy + sh; y++) {
      for (let x = sx; x < sx + sw; x++) {
        const o = (y * 96 + x) * 4
        sheet.data[o] = sr; sheet.data[o + 1] = sg; sheet.data[o + 2] = sb
      }
    }
  }
  const sheetPath = join(exDir, 'sheet.png')
  writeFileSync(sheetPath, encodePng(sheet, { level: 6 }))
  const sheetResult = extract(sheetPath, { out: join(exDir, 'out-sheet'), top: 4 })
  check('纯色底 + 一群小图仍判成精灵表', sheetResult.kind === 'sprite-sheet', sheetResult.kind)

  // 6) 工具层：anim_extract 走一遍完整路径，anim_extract_guide 读得到文档
  const extractCard = await callTool('anim_extract', { path: scenePath, out: join(exDir, 'out-tool'), top: 3 }, { agent: { session: { cwd: exDir } } })
  check('anim_extract 给出类型与落盘清单', extractCard.includes('类型：**scene**') && extractCard.includes('落盘文件'), extractCard.slice(0, 60))
  check('anim_extract 的卡片里有元素表', /\| # \| 角色 \|/.test(extractCard))
  check('anim_extract 的卡片带生图提示词', extractCard.includes('## 生图提示词'))
  check('anim_extract 把文件真的写进指定目录', existsSync(join(exDir, 'out-tool', 'report.md')) && existsSync(join(exDir, 'out-tool', 'crops')))
  const missingCard = await callTool('anim_extract', { path: join(exDir, 'no-such-file.png') }, {})
  check('anim_extract 路径不存在时给人话', missingCard.includes('找不到这张图'), missingCard.slice(0, 60))
  const toolGuide = await callTool('anim_extract_guide')
  check('anim_extract_guide 读到提取指南', toolGuide.length > 2000 && toolGuide.includes('anim_extract'), String(toolGuide.length))

  // 5c) README 里那张预览图必须真在仓库里：图丢了 README 就挂一张破图
  const previewPath = join(ROOT, 'assets', 'extract', 'preview.png')
  const sourceScene = join(ROOT, 'assets', 'extract', 'scene.png')
  check('assets/extract/preview.png 在仓库里（README 引用它）', existsSync(previewPath), previewPath)
  const previewImg = existsSync(previewPath) ? decodeImage(readFileSync(previewPath)) : null
  check('README 预览图是 1600×1000 的 PNG', previewImg?.width === 1600 && previewImg?.height === 1000,
    previewImg ? previewImg.width + 'x' + previewImg.height : 'missing')
  check('预览图的源图 scene.png 也在（可以自己重跑一遍）', existsSync(sourceScene), sourceScene)
} finally {
  rmSync(exDir, { recursive: true, force: true })
}

// ── 第五个数据源：video-shotcraft 镜头配方卡（124 张 / 10 分类 / 54 张海报）──
// 卡片与海报随包发在 assets/shots/，索引由 tools/build-shots.mjs 生成。
// 这里验证：索引与磁盘一致、索引不是旧的、查找与检索（含正文命中）、
// 读卡、海报路径、导出（含拒绝写进插件目录）、以及七个工具真的能跑。
const EXPECTED_SHOTS = 124
const EXPECTED_SHOT_POSTERS = 54
const EXPECTED_SHOT_STYLES = 150
const EXPECTED_SHOT_CATEGORIES = 10

const shots = loadShotCatalog(ROOT)
check('镜头卡数 = 124', shots.cards === EXPECTED_SHOTS && shots.entries.length === EXPECTED_SHOTS, '实际 ' + shots.cards + ' / ' + shots.entries.length)
check('镜头卡分类 = 10', shots.categories.length === EXPECTED_SHOT_CATEGORIES, '实际 ' + shots.categories.length)
check('上游风格数 = 150', shots.styles === EXPECTED_SHOT_STYLES, '实际 ' + shots.styles)
check('每类卡数之和 = 124', shots.categories.reduce((sum, row) => sum + row.cards, 0) === EXPECTED_SHOTS,
  shots.categories.map((row) => row.id + ':' + row.cards).join(' '))
check('分类名齐全（没有 misc）', shots.categories.every((row) => SHOT_CATEGORIES.some((def) => def.id === row.id && def.name === row.name)))

const missingCards = shots.entries.filter((entry) => !entry.filePath || !existsSync(entry.filePath))
check('124 张卡片文件都在磁盘上', missingCards.length === 0, '缺 ' + missingCards.length + ' 张：' + missingCards.slice(0, 5).map((e) => e.id).join(', '))
const posters = shots.entries.filter((entry) => shotPreviewPath(entry))
check('海报数 = 54', posters.length === EXPECTED_SHOT_POSTERS, '实际 ' + posters.length)
const brokenPosters = shots.entries.filter((entry) => entry.previewPath && !existsSync(entry.previewPath))
check('索引里的海报路径都真实存在', brokenPosters.length === 0, brokenPosters.slice(0, 5).map((e) => e.id).join(', '))
check('没有海报的卡不给假路径', shots.entries.filter((entry) => !entry.preview).every((entry) => shotPreviewPath(entry) === ''))

// 索引不能是旧的：拿构建脚本的 --check 再对一遍（它会解析全部 124 张卡）
let indexFresh = true
try {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build-shots.mjs'), '--check'], { stdio: 'pipe' })
} catch {
  indexFresh = false
}
check('index.json 与 124 张卡片一致（build-shots.mjs --check）', indexFresh)

// 单张读 + frontmatter
const firstShot = shots.entries[0]
const firstText = readShotCard(shots, firstShot)
const firstParsed = parseShotCard(firstText)
check('parseShotCard 取到六个字段', Boolean(firstParsed.meta.name && firstParsed.title && firstParsed.fit && firstParsed.duration && firstParsed.energy), JSON.stringify(firstParsed.meta).slice(0, 80))
check('parseShotCard 把 frontmatter 从正文里切掉', !firstParsed.body.startsWith('---') && firstParsed.body.includes('##'))
check('readShotCard 命中缓存', readShotCard(shots, firstShot) === firstText)
const withTags = shots.entries.filter((entry) => entry.tags.length > 0)
check('50 张卡带标签', withTags.length === 50, '实际 ' + withTags.length)
const withDemo = shots.entries.filter((entry) => entry.demo && /demos\//.test(entry.demo))
check('参考实现指向 demos/ 的卡 ≥ 100 张', withDemo.length >= 100, '实际 ' + withDemo.length)

// 查找
check('resolveShot 精确命中', resolveShot(shots, firstShot.id).entry?.id === firstShot.id)
check('resolveShot 容忍卡片名', resolveShot(shots, firstShot.card).entry?.id === firstShot.id)
check('resolveShot 容忍 .md 后缀与空格', resolveShot(shots, ' ' + firstShot.id + '.md ').entry?.id === firstShot.id)
check('resolveShot 未知 id 返回 missing', resolveShot(shots, 'opening/no-such-card').kind === 'missing')

// 检索：分类 / 标签 / 能量 / 海报 / 正文 / deep
const openingRows = searchShots(shots, { category: 'opening', limit: 200 }).map((row) => row.entry)
check('category=opening 返回 11 张', openingRows.length === 11, '实际 ' + openingRows.length)
check('category 也认中文名', searchShots(shots, { category: '开场与品牌', limit: 200 }).length === 11)
const lowRows = searchShots(shots, { energy: '低', limit: 200 }).map((row) => row.entry)
check('energy=低 只返回低能量卡', lowRows.length > 0 && lowRows.every((entry) => entry.energy.includes('低')), '实际 ' + lowRows.length)
const posterRows = searchShots(shots, { preview: true, limit: 200 }).map((row) => row.entry)
check('preview=true 只返回有海报的卡', posterRows.length === EXPECTED_SHOT_POSTERS, '实际 ' + posterRows.length)

// dashoffset 只出现在 brand-ink-open 的正文（动效核心）里，用来证「正文检索」真的进正文。
const bodyHit = searchShots(shots, { query: 'dashoffset', limit: 10 })
check('正文检索命中 brand-ink-open', bodyHit.some((row) => row.entry.card === 'brand-ink-open'), JSON.stringify(bodyHit.map((row) => row.entry.id)))
check('正文命中带命中行', (bodyHit.find((row) => row.entry.card === 'brand-ink-open')?.hits ?? []).length > 0)
const metaOnly = searchShots(shots, { query: 'dashoffset', deep: false, limit: 10 })
check('deep=false 时不进正文', metaOnly.length === 0, JSON.stringify(metaOnly.map((row) => row.entry.id)))
// 一词在标题、一词在正文：AND 仍然成立
const multiTerm = searchShots(shots, { query: '墨线 dashoffset', limit: 20 })
check('多词是 AND 关系（可跨元信息与正文）', multiTerm.length > 0 && multiTerm.every((row) => {
  const body = readShotCard(shots, row.entry)
  return (JSON.stringify(row.entry) + body).includes('墨线') && body.includes('dashoffset')
}), multiTerm.map((row) => row.entry.id).join(', '))
check('未知关键词返回空数组', searchShots(shots, { query: '这个词库里绝对没有出现过吧' }).length === 0)

// 统计
const stats = shotStats(shots)
check('shotStats 合计与索引一致', stats.cards === EXPECTED_SHOTS && stats.categories.length === EXPECTED_SHOT_CATEGORIES && stats.withPoster === EXPECTED_SHOT_POSTERS)
check('shotStats 给出上游与许可', stats.upstream.includes('video-shotcraft') && stats.license === 'Apache-2.0')

// 导出：临时目录，写卡 + 海报 + README + index.md
const shotWorkDir = mkdtempSync(join(tmpdir(), 'anim-pack-shots-'))
try {
  const pick = [
    shots.entries.find((entry) => entry.card === 'brand-ink-open'),
    shots.entries.find((entry) => entry.id === 'data/chart-live-moves'),
  ].filter(Boolean)
  check('挑到用于导出的两张卡', pick.length === 2)
  const exported = exportShots(shots, pick, { dir: join(shotWorkDir, 'out') })
  check('exportShots 返回文件清单', !exported.error && exported.files.length >= 5, JSON.stringify(exported).slice(0, 120))
  check('导出目录里有卡片 md', existsSync(join(shotWorkDir, 'out', 'brand-ink-open', 'brand-ink-open.md')))
  check('导出目录里有 README', existsSync(join(shotWorkDir, 'out', 'brand-ink-open', 'README.md')))
  check('导出目录里有海报 jpg', existsSync(join(shotWorkDir, 'out', 'chart-live-moves', 'chart-live-moves.jpg')))
  check('导出目录里有 index.md', existsSync(join(shotWorkDir, 'out', 'index.md')))
  const refused = exportShots(shots, pick, { dir: join(ROOT, 'assets', 'shots', 'nope') })
  check('exportShots 拒绝写进插件目录', Boolean(refused.error), JSON.stringify(refused).slice(0, 100))
} finally {
  rmSync(shotWorkDir, { recursive: true, force: true })
}

// 工具层
const shotStatsOut = JSON.parse(await callTool('anim_shot_stats'))
check('anim_shot_stats 报出 124 张 / 10 分类', shotStatsOut.cards === 124 && shotStatsOut.categories.length === 10, JSON.stringify(shotStatsOut).slice(0, 100))
const shotSearchOut = JSON.parse(await callTool('anim_shot_search', { category: 'data', limit: 10 }))
check('anim_shot_search 按分类返回 5 张', shotSearchOut.count === 5, '实际 ' + shotSearchOut.count)
const shotShowOut = await callTool('anim_shot_show', { id: 'brand-ink-open' })
check('anim_shot_show 输出摘要 + 正文', shotShowOut.includes('## 动效核心') && shotShowOut.includes('上游实现'), shotShowOut.slice(0, 80))
check('anim_shot_show 不带 frontmatter 重复段', !shotShowOut.includes('\n---\nname:'))
check('anim_shot_show 未知 id 给提示', (await callTool('anim_shot_show', { id: 'opening/zzz' })).includes('找不到'))
const shotPreviewOut = await callTool('anim_shot_preview', { ids: ['data/chart-live-moves', 'opening/brand-ink-open'] })
check('anim_shot_preview 给海报路径', shotPreviewOut.includes('unit-dot-swarm-regroup.jpg'), shotPreviewOut.slice(0, 120))
check('anim_shot_preview 无海报的卡如实说明', shotPreviewOut.includes('没配海报'), shotPreviewOut.slice(0, 200))

const shotExportDir = join(shotWorkDir, 'tool-out')
const shotExportOut = JSON.parse(await callTool('anim_shot_export', { ids: ['opening/brand-ink-open'], dir: shotExportDir }, { agent: { session: { cwd: shotWorkDir } } }))
check('anim_shot_export 真的落盘', shotExportOut.count === 1 && existsSync(join(shotExportDir, 'brand-ink-open', 'brand-ink-open.md')), JSON.stringify(shotExportOut).slice(0, 120))
check('anim_shot_export 不给 id 时给提示', (await callTool('anim_shot_export', {})).includes('没有给出要导出的卡'))
const shotRandomOut = await callTool('anim_shot_random', { category: 'outro' })
check('anim_shot_random 限定分类能抽到', shotRandomOut.includes('（outro）'), shotRandomOut.slice(0, 80))
const shotGuide = await callTool('anim_shot_guide')
check('anim_shot_guide 读到镜头卡指南', shotGuide.length > 2000 && shotGuide.includes('anim_shot_search'), String(shotGuide.length))

// ── 前端设计路由：一次调用给出风格 / 镜头 / 特效 / 配色，且说清下一步调谁 ──
const briefOut = await callTool('anim_design_brief', { task: '深色科技风的 AI 写作产品落地页' })
check('anim_design_brief 输出前端设计参考包', briefOut.includes('# 前端设计参考包') && briefOut.includes('## ⑥ 下一步'), briefOut.slice(0, 80))
check('brief 从任务描述认出落地页场景', briefOut.includes('surface=web-landing'), briefOut.slice(0, 220))
check('brief 给出能直接照抄的下一次调用',
  /anim_show\(id="/.test(briefOut) && /anim_shot_show\(id="/.test(briefOut), briefOut.slice(-320))
check('brief 带配色方案与版式要点',
  briefOut.includes('## ⑤ 版式与配色') && briefOut.includes('- 版式：'), briefOut.slice(0, 400))
check('brief 从工艺库带出锚点与配色变量',
  briefOut.includes('## ③ 美学锚点') && briefOut.includes('配色变量脚手架') && briefOut.includes('首选模式'), briefOut.slice(0, 600))

const dashBrief = await callTool('anim_design_brief', { task: '做个数据看板', surface: 'dashboard' })
check('显式 surface 优先于从任务猜（dashboard）', dashBrief.includes('surface=dashboard'), dashBrief.slice(0, 200))
const hudBrief = await callTool('anim_design_brief', { task: 'FPS 血条和准心', surface: '游戏 UI' })
check('surface 认中文名（游戏 UI → game-ui）', hudBrief.includes('surface=game-ui'), hudBrief.slice(0, 200))
const blankBrief = await callTool('anim_design_brief', {})
check('没写任务也照样给通用包', blankBrief.includes('# 前端设计参考包') && blankBrief.includes('（没写'), blankBrief.slice(0, 200))
check('brief 输出不臃肿（一条 < 6000 字符）', briefOut.length < 6000, String(briefOut.length))

check('resolveSurface 认中文场景名', resolveSurface('仪表盘').id === 'dashboard' && resolveSurface('游戏 UI').id === 'game-ui')
check('resolveSurface 认不出时回 generic', resolveSurface('乱七八糟的东西').id === 'generic')
const toks = tokensOf('深色科技风 AI 写作落地页')
check('tokensOf 拆出中英文关键词并带权重', toks.some((row) => row.token === '科技') && toks.some((row) => row.token === 'ai') && toks.every((row) => row.weight > 0), JSON.stringify(toks.slice(0, 6)))
const loneBrief = buildDesignBriefPure({ task: '做个页面' }, { styles: null, shots: null, fx: null })
check('三套索引全空时 brief 给 build 命令而不是崩', /build-catalog\.mjs/.test(loneBrief.text) && /build-shots\.mjs/.test(loneBrief.text) && /build-fx\.mjs/.test(loneBrief.text), loneBrief.text.slice(0, 200))

// ── 设计工艺库：数据完整性 + 检索 + 三个工具 ────────────────────────────────
const design = loadDesignLibrary(ROOT)
check('设计工艺库四份数据齐全', design.missing.length === 0, design.missing.join('、'))
check('工艺库计数 8 锚点 / 24 模式 / 15 准则',
  design.counts.anchors === 8 && design.counts.patterns === 24 && design.counts.heuristics === 15,
  JSON.stringify(design.counts))
check('每条锚点都有六个 token 与破法',
  design.anchors.entries.every((row) => ['surface', 'typography', 'accent', 'structure', 'texture', 'motion'].every((key) => typeof row[key] === 'string' && row[key].length > 0) && Array.isArray(row.breaksIf) && row.breaksIf.length > 0),
  '缺字段的锚点：' + design.anchors.entries.filter((row) => !row.surface || !row.breaksIf?.length).map((row) => row.id).join('、'))
check('每条模式都带可抄的 CSS 与分类',
  design.patterns.entries.every((row) => typeof row.css === 'string' && row.css.includes('{') && PATTERN_CATEGORIES.some((cat) => cat.id === row.category)),
  '有问题的模式：' + design.patterns.entries.filter((row) => !row.css).map((row) => row.id).join('、'))
check('每条准则都有查法与严重度',
  design.heuristics.entries.every((row) => Array.isArray(row.lookFor) && row.lookFor.length > 0 && Array.isArray(row.severity) && row.severity.length >= 3))
check('规则集有反 AI 味 / 配色原型 / 字体配对',
  (design.rules.antiPatterns ?? []).length >= 12 && (design.rules.palettes ?? []).length === 5 && (design.rules.typePairings ?? []).length === 5,
  JSON.stringify({ anti: design.rules.antiPatterns?.length, palettes: design.rules.palettes?.length }))
check('设计工艺库 catalog.json 计数与数据一致', (() => {
  const file = join(ROOT, 'assets', 'design', 'catalog.json')
  if (!existsSync(file)) return false
  const catalog = JSON.parse(readFileSync(file, 'utf8'))
  return JSON.stringify(catalog.counts) === JSON.stringify(design.counts)
})(), '跑一次 node tools/build-design.mjs')
check('四份数据文件都在',
  DESIGN_FILES.every((name) => existsSync(join(ROOT, 'assets', 'design', name + '.json'))))

check('resolveAnchor 认 id 与中文名', resolveAnchor(design, 'brutalist').entry?.id === 'brutalist' && resolveAnchor(design, '瑞士').entry?.id === 'swiss')
check('resolveAnchor 认不出时为空而不是乱给', resolveAnchor(design, '不存在的风格').entry === null)
check('searchPatterns 每词都必须命中，全不中时退成部分命中',
  searchPatterns(design, { query: '悬停 抬升', limit: 5 }).every((row) => /悬停|抬升/.test([row.entry.name, row.entry.why, row.entry.when, row.entry.css].join(' '))) &&
    searchPatterns(design, { query: '数据看板 卡片', limit: 3 }).length > 0,
  '严格档与降级档都要有结果')
let designThrew = ''
try {
  loadDesignLibrary(ROOT, { dir: 'assets/design-nope' })
} catch (error) {
  designThrew = String(error?.message ?? error)
}
check('工艺库全缺时给出可照做的报错', /cannot read design library/.test(designThrew), designThrew)

const anchorListOut = await callTool('anim_design_anchors')
check('anim_design_anchors 列出八条', anchorListOut.includes('八条美学锚点') && anchorListOut.includes('swiss') && anchorListOut.includes('复古未来'), anchorListOut.slice(0, 120))
const anchorOut = await callTool('anim_design_anchors', { query: 'swiss' })
check('anim_design_anchors 读一条给 token 与破法', anchorOut.includes('会破的写法') && anchorOut.includes('- 字：'), anchorOut.slice(0, 120))
check('anim_design_anchors 未知 id 给提示', (await callTool('anim_design_anchors', { query: 'zzz' })).includes('找不到锚点'))

const patternListOut = await callTool('anim_design_patterns')
check('anim_design_patterns 不给条件时列 7 类', patternListOut.includes('版式与交互模式') && patternListOut.includes('utility'), patternListOut.slice(0, 120))
const patternOut = await callTool('anim_design_patterns', { category: 'layout', limit: 3 })
check('anim_design_patterns 按分类给 CSS', (patternOut.match(/\{/g) ?? []).length >= 3 && patternOut.includes('--'), patternOut.slice(0, 200))
check('anim_design_patterns 抄 CSS 前提醒换 token', patternOut.includes('换成项目自己的 token'), patternOut.slice(-160))

const auditOut = await callTool('anim_design_audit')
check('anim_design_audit 出 15 条审查清单', auditOut.includes('# 前端设计审查清单') && (auditOut.match(/原则：/g) ?? []).length === 15, String(auditOut.length))
check('审查清单带严重度标尺与反 AI 味', auditOut.includes('严重度：') && auditOut.includes('## 反 AI 味'))
const auditFocusOut = await callTool('anim_design_audit', { focus: 'accessibility' })
check('审查清单 focus 只展开一条', auditFocusOut.includes('## 无障碍') && auditFocusOut.includes('代码层这样查：'), auditFocusOut.slice(0, 160))
check('auditChecklist 纯函数与工具输出一致', auditChecklist(design, { focus: '' }).startsWith('# 前端设计审查清单'))

const companion = join(homedir(), '.agents', 'skills', 'frontend-art-reference', 'SKILL.md')
if (existsSync(companion)) {
  const body = readFileSync(companion, 'utf8')
  check('伴随技能 frontend-art-reference 已安装且提到 brief', body.includes('anim_design_brief'), companion)
} else {
  console.log('  · 跳过：伴随技能还没装（node tools/install.mjs 会写）')
}

// ── 联网检查（node tools/verify.mjs --refs）：真的搜图、看详情、下载一张 ────
// 只有 --refs 且地址不是占位时才跑：DSH_REF_BASE=http://你的库 node tools/verify.mjs --refs
const LIVE = process.argv.includes('--refs') && !/^(127[.]0[.]0[.]1|localhost)$/.test(new URL(refDefaults.base).hostname)
if (process.argv.includes('--refs') && !LIVE) {
  console.log('（提示：--refs 需要真实素材库地址，先设 DSH_REF_BASE=http://你的库；占位地址下跳过联网检查）')
}
if (LIVE) {
  const liveDir = mkdtempSync(join(tmpdir(), 'anim-pack-refs-'))
  try {
    const sourcesOut = await callTool('anim_ref_sources')
    check('联网 · anim_ref_sources 报出家底', sourcesOut.includes('美术素材库 ·') && /\d{4,} 张/.test(sourcesOut), sourcesOut.slice(0, 80))
    check('联网 · 家底里分类与来源都列全', /## 分类/.test(sourcesOut) && /## 来源/.test(sourcesOut) && /## 配色聚类/.test(sourcesOut))

    const searchOut = JSON.parse(await callTool('anim_ref_search', { query: '水墨', limit: 5 }))
    check('联网 · 中文关键词「水墨」能搜到', searchOut.total > 0 && searchOut.results.length > 0, JSON.stringify(searchOut).slice(0, 120))
    check('联网 · 结果带缩略图绝对地址', searchOut.results.every((row) => /^http:\/\//.test(row.urls?.thumb ?? '')), JSON.stringify(searchOut.results[0]?.urls ?? {}))
    check('联网 · 结果带来源页与授权', searchOut.results.every((row) => row.page && row.license))

    const catOut = JSON.parse(await callTool('anim_ref_search', { category: '绘本', limit: 3 }))
    check('联网 · 中文分类名「绘本」能当筛选条件', catOut.total > 0 && catOut.results.every((row) => row.category === 'storybook'), JSON.stringify(catOut.results.map((row) => row.category)))

    const dlOut = JSON.parse(await callTool('anim_ref_search', { query: '材质', limit: 2, download: true, variant: 'small', dir: liveDir }))
    check('联网 · download=true 时结果带 localPath', dlOut.results.every((row) => typeof row.localPath === 'string' && existsSync(row.localPath)), JSON.stringify(dlOut.results.map((row) => row.localPath)))
    check('联网 · 下载下来的图不是空文件', dlOut.results.every((row) => statSync(row.localPath).size > 1000))

    const firstId = searchOut.results[0]?.id
    const showOut = await callTool('anim_ref_show', { id: firstId, variant: 'thumb', dir: liveDir })
    check('联网 · anim_ref_show 输出元信息', showOut.includes('# ' + firstId) && showOut.includes('授权：'), showOut.slice(0, 100))
    const localLine = showOut.split('\n').find((line) => line.includes('本地文件')) || ''
    const localPath = localLine.replace(/^.*：/, '').trim()
    check('联网 · anim_ref_show 把图落地', existsSync(localPath) && statSync(localPath).size > 1000, localPath)

    const pickOut = JSON.parse(await callTool('anim_ref_pick', { category: 'palette', count: 2, dir: liveDir }))
    check('联网 · anim_ref_pick 抽到 2 张并落地', pickOut.results.length === 2 && pickOut.results.every((row) => existsSync(row.localPath)), JSON.stringify(pickOut.results.map((row) => row.localPath)))

    const missingOut = await callTool('anim_ref_show', { id: 'no_such_item_999' })
    check('联网 · 未知 id 给提示而不是抛错', missingOut.includes('没有 id'), missingOut.slice(0, 80))
  } finally {
    rmSync(liveDir, { recursive: true, force: true })
  }
}

// ── 结果 ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\nFAIL — ${passed} 项通过，${failures.length} 项失败：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  process.exit(1)
}
console.log(`PASS — ${passed} 项检查全部通过（341 条风格 / 193 张静帧 / 10 个系列 / 244 个特效 / 124 张镜头卡 / ${TOOL_NAMES.length} 个工具${LIVE ? ' / 素材库联网已验' : ''}）`)
