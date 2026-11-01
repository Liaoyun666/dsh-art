#!/usr/bin/env node
/**
 * dsh-anim-pack 安装器 / 卸载器。
 *
 * 素材库（76MB / 346 个 md / 193 张 jpg）就放在本包的 assets/ 里，安装只做三件轻事：
 *   1. 在 profile 的 node_modules 建 junction（Loader 靠它把 `dsh-anim-pack` 解析到本包）；
 *   2. 把托管块追加进 profile 自己的 cordis.patch.yml（默认 patch 方式）；
 *   3. 或者写进 package.json 的 dependencies + dsh.profile.bundles（--bundle 方式）。
 *
 * 两种登记方式任选其一，脚本保证不会同时上两处（同一 id 插两次会打架）：
 *
 *  · patch（默认）：profile 是 patchReload: live，补丁层会热重载，刷新页面/开新会话
 *      就能看到 anim_* 工具，不必重启 dsh。缺点是不进 profile 依赖清单。
 *
 *  · bundle（--bundle）：等价于官方 `dsh plugin --profile <p> add link:<本包>`，
 *      本包的 cordis.patch.yml 成为一层装配层；bundle 列表在启动时结算，需要重启 dsh。
 *
 * 用法：
 *   node tools/install.mjs                     # patch 方式装进 desktop profile
 *   node tools/install.mjs web                 # 指定 profile
 *   node tools/install.mjs --bundle            # bundle 方式
 *   node tools/install.mjs --status            # 看现状（含模块加载自检）
 *   node tools/install.mjs --uninstall         # 撤掉两种登记与 junction
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginManifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const packageName = pluginManifest.name
if (typeof packageName !== 'string' || packageName === '') throw new Error('本包 package.json 缺少 name')

/** 宿主行 id：cordis.patch.yml 里的 loader 行。 */
const ROW_ID = 'anim-pack'
/** 补丁层托管块的首尾标记（卸载时按标记精确摘除）。 */
const BLOCK_BEGIN = `# ── ${packageName} (managed block; 由 tools/install.mjs 维护) ──`
const BLOCK_END = `# ── /${packageName} ──`
/** 托管块里要不要顺手写上 refBase：装了自建素材库的机器用环境变量给，仓库里不放地址。 */
const MANAGED_REF_BASE = (process.env.ANIM_PACK_REF_BASE ?? '').trim()

const BLOCK = `${BLOCK_BEGIN}
# 本地：341 种代码动画风格提示词 + 193 张参考静帧（anim_list_series / anim_search /
# anim_show / anim_still / anim_export / anim_random / anim_guide）。
# 远端：自建美术参考图库（anim_ref_sources / anim_ref_search / anim_ref_show /
# anim_ref_pick）。地址按 config.refBase → 环境变量 DSH_REF_BASE → 占位地址取，
# 代码里不写死；没有自建库时这四条工具会如实说「没连上」，不影响本地素材。
# 特效：pixelfx 的 244 条像素特效（anim_fx_stats / search / show / preview / export /
# random / guide）。镜像路径 config.fxPath，导出缺省目录 config.fxExportDir。
- insert:
    - id: ${ROW_ID}
      name: ${packageName}
${MANAGED_REF_BASE ? '      config:\n        refBase: ' + MANAGED_REF_BASE + '\n' : ''}${BLOCK_END}
`

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((value) => value.startsWith('--')))
const rest = argv.filter((value) => !value.startsWith('--'))
const profile = rest[0] ?? 'desktop'

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(home, 'profiles', profile)
const profileManifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')
const link = join(profileDir, 'node_modules', packageName)

if (!existsSync(profileManifestPath)) {
  console.error(`找不到 profile ${JSON.stringify(profile)} 的清单：${profileManifestPath}`)
  console.error(`先跑一次 dsh --profile ${profile} 让 dsh 把 profile 建出来。`)
  process.exit(1)
}

const readProfileManifest = () => JSON.parse(readFileSync(profileManifestPath, 'utf8'))
const writeProfileManifest = (manifest) => writeFileSync(profileManifestPath, `${JSON.stringify(manifest, void 0, 2)}\n`)
/** 读补丁层；profile 里还没这个文件时给一份带表头的空列表。 */
const readPatchFile = () =>
  existsSync(patchPath)
    ? readFileSync(patchPath, 'utf8')
    : `# ${profile} profile 的用户补丁层：顶层 YAML 数组的 loader 补丁条目。\n[]\n`

/** junction 现状：undefined=不存在，false=同名实体目录，字符串=指向。 */
function linkTarget() {
  try {
    const stat = lstatSync(link)
    return stat.isSymbolicLink() ? readlinkSync(link) : false
  } catch {
    return undefined
  }
}

/** 摘掉托管块。 */
function stripBlock(text) {
  const start = text.indexOf(BLOCK_BEGIN)
  if (start === -1) return text
  const end = text.indexOf(BLOCK_END, start)
  if (end === -1) return text
  return text.slice(0, start) + text.slice(end + BLOCK_END.length)
}

/** 追加托管块（先把 `[]` 空列表占位去掉，避免解析出两个顶层值）。 */
function withBlock(text) {
  let base = stripBlock(text)
  base = base.replace(/^[ \t]*\[[ \t]*\][ \t]*\r?\n?/m, '')
  if (base !== '' && !base.endsWith('\n')) base += '\n'
  return `${base}${BLOCK}`
}

/** 摘干净后如果一行补丁都不剩，补回 `[]`（补丁文件必须是顶层数组）。 */
function withoutBlock(text) {
  const base = stripBlock(text)
  if (base.split('\n').some((line) => /^\s*-\s/.test(line))) return base
  return base.replace(/\s*$/, '\n\n[]\n')
}

const hasPatchBlock = existsSync(patchPath) && readFileSync(patchPath, 'utf8').includes(BLOCK_BEGIN)
const manifestNow = readProfileManifest()
const hasBundle = (manifestNow.dsh?.profile?.bundles ?? []).includes(packageName)
const target = linkTarget()

/** 模块自检：插件文件能否被 node 直接加载，导出的东西对不对。 */
async function selfCheck() {
  const lines = []
  try {
    const mod = await import(pathToFileURL(join(pluginDir, 'lib', 'index.js')).href)
    lines.push(`  name      : ${mod.name ?? '（缺失！）'}`)
    lines.push(`  inject    : ${Array.isArray(mod.inject) ? mod.inject.join(', ') : '（缺失！）'}`)
    lines.push(`  apply     : ${typeof mod.apply === 'function' ? 'function ✓' : '（缺失！）'}`)
  } catch (error) {
    lines.push(`  加载失败  : ${error?.message ?? error}`)
  }
  try {
    const { loadCatalog } = await import(pathToFileURL(join(pluginDir, 'lib', 'catalog.js')).href)
    const catalog = loadCatalog(pluginDir)
    lines.push(`  素材库    : ${catalog.total} 条 / ${catalog.withStill} 张静帧 / ${catalog.series.length} 个系列`)
  } catch (error) {
    lines.push(`  素材库失败: ${error?.message ?? error}`)
  }
  try {
    const { loadFxCatalog, fxStats } = await import(pathToFileURL(join(pluginDir, 'lib', 'fx.js')).href)
    const stats = fxStats(loadFxCatalog(pluginDir))
    lines.push(`  特效库    : ${stats.total} 条 / ${stats.categories.length} 个分类 / ${stats.acted} 条带角色 / ${stats.withPreview} 张预览`)
  } catch (error) {
    lines.push(`  特效库失败: ${error?.message ?? error}`)
  }
  return lines.join('\n')
}

if (flags.has('--status')) {
  console.log(`profile      : ${profile} (${profileDir})`)
  console.log(`node_modules : ${target === undefined ? '（无 junction）' : target === false ? '（同名实体目录，未接管）' : target}`)
  console.log(`patch 登记   : ${hasPatchBlock ? `已写入 ${patchPath}` : '未登记'}`)
  console.log(`bundle 登记  : ${hasBundle ? '已写入 package.json (dependencies + dsh.profile.bundles)' : '未登记'}`)
  console.log('模块自检：')
  console.log(await selfCheck())
  process.exit(0)
}

if (flags.has('--uninstall')) {
  if (typeof target === 'string') rmSync(link, { force: true })
  if (hasPatchBlock) writeFileSync(patchPath, withoutBlock(readPatchFile()))
  const manifest = readProfileManifest()
  if (manifest.dependencies?.[packageName] !== undefined) delete manifest.dependencies[packageName]
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (bundles.includes(packageName)) {
    manifest.dsh.profile.bundles = bundles.filter((value) => value !== packageName)
  }
  writeProfileManifest(manifest)
  console.log(`已卸载 ${packageName}（profile ${profile}）：junction、补丁块、bundle 登记都已撤掉。`)
  console.log('素材文件仍在 dsh-plugins/dsh-anim-pack/，没有动过。')
  process.exit(0)
}

// ── 安装 ────────────────────────────────────────────────────────────────────

/** 动手之前留一份 .bak（同一份只留最近一次，避免堆文件）。 */
function backup(pathToBackup) {
  if (!existsSync(pathToBackup)) return
  writeFileSync(`${pathToBackup}.bak-${packageName}`, readFileSync(pathToBackup))
}

// 1. node_modules junction（幂等；绝不覆盖同名实体目录）
mkdirSync(dirname(link), { recursive: true })
if (target === false) {
  console.error(`拒绝覆盖实体目录：${link}（请先确认它是什么）`)
  process.exit(1)
}
if (target !== undefined) rmSync(link, { force: true })
symlinkSync(pluginDir, link, 'junction')

if (flags.has('--bundle')) {
  const manifest = readProfileManifest()
  manifest.dependencies = { ...manifest.dependencies, [packageName]: `link:${pluginDir}` }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(packageName)) bundles.push(packageName)
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  backup(profileManifestPath)
  writeProfileManifest(manifest)
  if (hasPatchBlock) writeFileSync(patchPath, withoutBlock(readPatchFile()))
  console.log(`已安装 ${packageName}（bundle 方式）`)
  console.log(`  junction : ${link} -> ${pluginDir}`)
  console.log(`  依赖     : dependencies.${packageName} = link:${pluginDir}`)
  console.log(`  装配层   : dsh.profile.bundles = [${bundles.join(', ')}]`)
  console.log('  bundle 列表在启动时结算：重启 dsh 后生效。')
} else {
  backup(patchPath)
  writeFileSync(patchPath, withBlock(readPatchFile()))
  if (hasBundle) {
    const manifest = readProfileManifest()
    delete manifest.dependencies?.[packageName]
    const bundles = (manifest.dsh?.profile?.bundles ?? []).filter((value) => value !== packageName)
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeProfileManifest(manifest)
    console.log('（原先的 bundle 登记已撤销，避免同一行被插入两次）')
  }
  console.log(`已安装 ${packageName}（patch 方式）`)
  console.log(`  junction : ${link} -> ${pluginDir}`)
  console.log(`  补丁层   : ${patchPath}`)
  console.log(`  装配行   : - insert: [{ id: ${ROW_ID}, name: ${packageName} }]`)
  console.log('  profile 是 patchReload: live：补丁层会热重载，刷新页面/开新会话即可看到 anim_* 工具。')
}

console.log('模块自检：')
console.log(await selfCheck())
