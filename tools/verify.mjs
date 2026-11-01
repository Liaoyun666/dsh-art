#!/usr/bin/env node
/**
 * dsh-anim-pack 冒烟测试：不启动 DSH，直接用 node 验证 lib/catalog.js 的行为。
 *
 *   node tools/verify.mjs
 *
 * 检查项：素材库完整性（341 条索引 / 341 个提示词文件 / 193 张静帧真的在磁盘上）、
 * 编号查找、关键词与系列检索、读提示词、导出到临时目录、拒绝写进库内部，
 * 第二个数据源（自建美术素材库）客户端的离线单测，以及第三个数据源
 * （镜像进来的 patch-gg/pixelfx：244 个特效）的索引、查找、导出与真渲染。
 * 全部通过打印 PASS，有任何一条不过就以退出码 1 结束。
 *
 *   node tools/verify.mjs --refs     额外跑联网检查：真的去素材库搜图、取详情、下载一张图。
 *                                    地址取 DSH_REF_BASE / config.refBase；不联网时不要加。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// ── 插件注册：用假 ctx 跑一遍 apply()，18 个工具都得能真的执行 ─────────────
const registered = []
const fakeCtx = { tools: { register: (tool) => registered.push(tool) }, logger: { info: () => {} } }
const { apply } = await import('../lib/index.js')
apply(fakeCtx, {})

const TOOL_NAMES = [
  'anim_list_series', 'anim_search', 'anim_show', 'anim_still', 'anim_export', 'anim_random', 'anim_guide',
  'anim_ref_sources', 'anim_ref_search', 'anim_ref_show', 'anim_ref_pick',
  'anim_fx_stats', 'anim_fx_search', 'anim_fx_show', 'anim_fx_preview', 'anim_fx_export', 'anim_fx_random', 'anim_fx_guide',
]
const toolsByName = new Map(registered.map((tool) => [tool.name, tool]))
check('注册了 18 个工具', registered.length === TOOL_NAMES.length, `实际 ${registered.length}：${registered.map((t) => t.name).join(', ')}`)
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
console.log(`PASS — ${passed} 项检查全部通过（341 条风格 / 193 张静帧 / 10 个系列 / 244 个特效 / 18 个工具${LIVE ? ' / 素材库联网已验' : ''}）`)
