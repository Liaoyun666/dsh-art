// dsh-anim-pack — 文字与前端美化素材（第八个数据源）
//
// 这里放四类「配方」和两类「查询」：
//   · 配方：文字特效 37 / 文字动效 16 / 装饰与贴纸 32 / 参数化背景 14，
//     另有插画外接源 10 个、字体种子清单 71 条。配方全部是可直接粘的 HTML + CSS，
//     每条带「什么时候用 / 参数 / 坑」——模型抄的时候不会抄出个半成品。
//   · 查询：字体（本地种子 + Google/Fontshare 联网校验）、图标组（Iconify 按集检索）。
//
// 设计取舍：
//   1) 不给文字特效渲预览图。插件里的 canvas 是自己写的像素缓冲，没有字体渲染，
//      硬画出来的是假图。要预览就导出 HTML 画廊（exportTypeGallery），浏览器里看真的。
//   2) 配方一律「自包含」：一份 HTML 片段 + 一段 CSS，不依赖构建工具、不依赖 class 前缀。
//      想批量套用的人自己加作用域（画廊里用 iframe srcdoc 天然隔离）。
//   3) 联网只做「校验/补充」，离线永远有东西可给：字体种子、Illustration 源清单都在本地。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TYPE_DIR_REL = join('assets', 'type');
export const ICONIFY_API = 'https://api.iconify.design';
export const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2';
export const FONTSHARE_API = 'https://api.fontshare.com/v2';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_SEARCH_LIMIT = 80;

const FILES = {
  effect: 'effects.json',
  motion: 'motion.json',
  decor: 'decor.json',
  background: 'background.json',
  illustration: 'illustration.json',
  font: 'fonts.json',
};

function readJson(file) {
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('读不了 ' + file + '：' + err.message);
  }
}

function normRecipe(entry, kind) {
  return {
    ...entry,
    kind,
    id: String(entry.id || '').trim(),
    name: String(entry.name || entry.id || '').trim(),
    when: entry.when || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    params: entry.params || '',
    html: entry.html || '',
    css: entry.css || '',
    pitfall: entry.pitfall || '',
    format: entry.format || (kind === 'illustration' ? entry.kind : ''),
  };
}

function normFont(entry) {
  return {
    ...entry,
    kind: 'font',
    id: String(entry.family || '').toLowerCase().replace(/\s+/g, '-'),
    name: String(entry.family || ''),
    when: entry.note || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    params: entry.weights || '',
    cjk: !!entry.cjk,
  };
}

export function loadTypeLibrary(root, options = {}) {
  const dir = options.dir ? resolve(String(options.dir)) : join(root, TYPE_DIR_REL);
  if (!existsSync(dir)) throw new Error('文字/美化素材目录不存在：' + dir);
  const lib = { dir, effects: [], motion: [], decor: [], background: [], illustration: [], fonts: [], byId: new Map(), byKey: new Map(), errors: [] };
  for (const kind of Object.keys(FILES)) {
    const file = join(dir, FILES[kind]);
    if (!existsSync(file)) { lib.errors.push('缺文件 ' + file); continue; }
    let data;
    try { data = readJson(file); } catch (err) { lib.errors.push(err.message); continue; }
    const entries = Array.isArray(data) ? data : (data.entries || []);
    const list = kind === 'font' ? entries.map(normFont) : entries.map((e) => normRecipe(e, kind));
    const key = { effect: 'effects', motion: 'motion', decor: 'decor', background: 'background', illustration: 'illustration', font: 'fonts' }[kind];
    lib[key] = list;
    for (const entry of list) {
      if (!entry.id) continue;
      const id = entry.id;
      // 同一个 id 可能在不同类别里各出现一次（背景和装饰都有 paper / blueprint / spotlight）。
      // 裸 id 保留第一个，另外登记 kind:id 让调用方精确指定，不靠猜。
      lib.byKey.set(entry.kind + ':' + id, entry);
      if (!lib.byId.has(id)) lib.byId.set(id, entry);
      else lib.errors.push('同 id 跨类：' + id + '（用 ' + entry.kind + ':' + id + ' 指定；裸 id 指向「' + lib.byId.get(id).kind + '」那条）');
      const alias = String(entry.name || '').toLowerCase().replace(/\s+/g, '-');
      if (alias && !lib.byId.has(alias)) lib.byId.set(alias, entry);
      else if (alias && alias !== id) lib.byKey.set(entry.kind + ':' + alias, entry);
    }
  }
  lib.counts = {
    effect: lib.effects.length,
    motion: lib.motion.length,
    decor: lib.decor.length,
    background: lib.background.length,
    illustration: lib.illustration.length,
    font: lib.fonts.length,
  };
  lib.counts.total = Object.values(lib.counts).reduce((a, b) => a + b, 0);
  lib.categories = {};
  for (const kind of ['effects', 'motion', 'decor', 'background']) {
    const map = new Map();
    for (const e of lib[kind]) {
      const cat = e.category || 'misc';
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    lib.categories[kind] = [...map.entries()].map(([id, count]) => ({ id, count }));
  }
  return lib;
}

export function typeStats(lib) {
  return {
    counts: { ...lib.counts },
    categories: lib.categories,
    files: lib.errors,
  };
}

// 中文口语「水墨/霓虹/高级感」在配方里未必出现，先按同义词展开成几组候选词。
export const TYPE_SYNONYMS = {
  水墨: ['国风', '书法', '毛笔', '竖排'],
  书法: ['毛笔', '行书'],
  国风: ['水墨', '竖排', '纸'],
  霓虹: ['发光', 'neon'],
  发光: ['霓虹', '柔光', 'glow'],
  赛博: ['故障', '霓虹', 'hud'],
  故障: ['glitch', '切片', '扫描线'],
  高级: ['柔光', '极简', '编辑', '衬线'],
  极简: ['瑞士', '细边框', '留白'],
  复古: ['retro', '80s', '70s', '做旧'],
  卡通: ['贴纸', '圆润'],
  可爱: ['贴纸', '圆润', '糖果'],
  杂志: ['编辑', '衬线', '大标题'],
  科技: ['渐变', 'hud', '网格', 'space'],
  梦幻: ['柔光', '极光', '渐变'],
  手绘: ['手写', '胶带', '圈注', '便签'],
  报纸: ['编辑', '衬线', '黑白'],
  促销: ['角标', '星标', '条纹'],
  国潮: ['国风', '印章', '竖排'],
  投影: ['阴影', '硬投影', '长投影'],
  描边: ['空心', '描边'],
  纹理: ['噪点', '颗粒', '纸'],
  海报: ['标题', '大标题'],
  游戏: ['hud', '像素', 'crt'],
  数据: ['数字', '等宽', '仪表盘'],
};

function tokensOf(query) {
  return String(query || '').toLowerCase().split(/[\s,，。;；/|]+/).filter(Boolean);
}

function recipeScore(entry, token) {
  const fields = [
    [entry.name, 5],
    [entry.tags.join(' '), 4],
    [entry.when, 3],
    [entry.params, 2],
    [entry.pitfall, 1],
    [entry.category || '', 1],
  ];
  let score = 0;
  for (const [text, weight] of fields) {
    if (text && String(text).toLowerCase().includes(token)) score += weight;
  }
  return score;
}

export function expandTypeTokens(query) {
  const raw = tokensOf(query);
  const groups = raw.map((token) => [token].concat(TYPE_SYNONYMS[token] || TYPE_SYNONYMS[token.toLowerCase()] || []));
  const expanded = [];
  groups.forEach((group, index) => {
    if (group.length > 1) expanded.push(raw[index] + '→' + group.slice(1, 3).join('/'));
  });
  return { raw: raw, groups: groups, expanded: expanded };
}

export function searchType(lib, options = {}) {
  const query = String(options.query || '').trim();
  const kind = options.kind ? String(options.kind) : '';
  const category = options.category ? String(options.category) : '';
  const tags = Array.isArray(options.tags) ? options.tags.map((t) => String(t).toLowerCase()) : [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, MAX_SEARCH_LIMIT));
  const pools = [];
  for (const k of ['effect', 'motion', 'decor', 'background', 'illustration', 'font']) {
    if (kind && k !== kind) continue;
    const list = { effect: lib.effects, motion: lib.motion, decor: lib.decor, background: lib.background, illustration: lib.illustration, font: lib.fonts }[k];
    for (const entry of list) pools.push(entry);
  }
  if (!query && !category && !tags.length) {
    return { total: pools.length, rows: pools.slice(0, limit).map((entry) => ({ entry, score: 0 })), relaxed: false, tokens: [], expanded: [] };
  }
  const expandedQuery = expandTypeTokens(query);
  const groups = expandedQuery.groups;
  const strict = [];
  const partial = [];
  for (const entry of pools) {
    if (category && entry.category !== category) continue;
    if (tags.length) {
      const own = entry.tags.map((t) => String(t).toLowerCase());
      if (!tags.every((t) => own.some((x) => x.includes(t)))) continue;
    }
    let score = 0;
    let matched = 0;
    for (const group of groups) {
      let best = 0;
      for (const token of group) {
        const hit = recipeScore(entry, token);
        if (hit > best) best = hit;
      }
      if (best > 0) { matched += 1; score += best; }
    }
    if (groups.length && matched === groups.length) strict.push({ entry, score, matched });
    else if (groups.length && matched >= Math.ceil(groups.length / 2)) partial.push({ entry, score: score + matched, matched });
    else if (!groups.length) strict.push({ entry, score: 0, matched: 0 });
  }
  let rows = strict;
  let relaxed = false;
  if (!rows.length && partial.length) {
    rows = partial;
    relaxed = true;
  }
  rows.sort((a, b) => b.score - a.score || String(a.entry.id).localeCompare(String(b.entry.id)));
  return { total: rows.length, rows: rows.slice(0, limit), relaxed, tokens: expandedQuery.raw, expanded: expandedQuery.expanded };
}

export function resolveType(lib, input) {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'missing', entry: null, candidates: [] };
  const key = raw.toLowerCase().replace(/\s+/g, '-');
  const qualified = /^[a-z]+:/.test(key) ? lib.byKey?.get(key) : null;
  if (qualified) return { kind: 'exact', entry: qualified, candidates: [] };
  const exact = lib.byId.get(raw) || lib.byId.get(key);
  if (exact) return { kind: 'exact', entry: exact, candidates: [] };
  const lower = raw.toLowerCase();
  const loose = [...new Set(lib.byId.values())].filter((e) => e.name.toLowerCase().includes(lower) || e.id.includes(lower));
  if (loose.length === 1) return { kind: 'loose', entry: loose[0], candidates: [] };
  if (loose.length > 1) return { kind: 'ambiguous', entry: null, candidates: loose.slice(0, 8) };
  return { kind: 'missing', entry: null, candidates: [] };
}

export function summarizeType(entry) {
  const bits = ['[' + entry.kind + '] ' + entry.name];
  if (entry.category) bits.push('分类 ' + entry.category);
  if (entry.tags.length) bits.push(entry.tags.join(' / '));
  if (entry.when) bits.push('—— ' + entry.when);
  return bits.join(' · ');
}

export function renderType(entry) {
  const lines = [];
  lines.push('# ' + entry.name + '（' + entry.kind + (entry.category ? ' / ' + entry.category : '') + '）');
  lines.push('');
  if (entry.when) lines.push('- 什么时候用：' + entry.when);
  if (entry.params) lines.push('- 参数：' + entry.params);
  if (entry.tags.length) lines.push('- 标签：' + entry.tags.join(' / '));
  if (entry.kind === 'font') {
    lines.push('- 来源：' + entry.source + ' · 字重：' + (entry.weights || '未知') + ' · 许可：' + (entry.license || '未标注'));
    if (entry.cjk) lines.push('- 中文：是（中文场景先看子集与行高）');
    if (entry.pair) lines.push('- 搭配建议：' + entry.pair);
    if (entry.note) lines.push('- 备注：' + entry.note);
    lines.push('');
    lines.push('下一步：anim_font_css(family="' + entry.name + '", source="' + entry.source + '") 生成引入代码。');
    return lines.join('\n');
  }
  if (entry.kind === 'illustration') {
    lines.push('- 站点：' + entry.site);
    lines.push('- 格式：' + (entry.format || 'svg'));
    lines.push('- 授权：' + entry.license);
    lines.push('- 备注：' + (entry.note || ''));
    lines.push('- 怎么拿：' + entry.how);
    return lines.join('\n');
  }
  if (entry.kind === 'background') {
    const gen = generateBackground(entry);
    lines.push('- 默认配色：' + JSON.stringify(entry.defaults || {}));
    lines.push('');
    lines.push('## CSS');
    lines.push('```css');
    lines.push(gen.css);
    lines.push('```');
    if (entry.extra) lines.push('叠加：' + entry.extra);
    return lines.join(String.fromCharCode(10));
  }
  if (entry.html) {
    lines.push('');
    lines.push('## HTML');
    lines.push('```html');
    lines.push(entry.html);
    lines.push('```');
  }
  if (entry.css) {
    lines.push('');
    lines.push('## CSS');
    lines.push('```css');
    lines.push(entry.css);
    lines.push('```');
  }
  if (entry.pitfall) {
    lines.push('');
    lines.push('## 坑');
    lines.push(entry.pitfall);
  }
  lines.push('');
  lines.push('想一次看多条效果：anim_type_export(ids=["…"], dir="…") 生成 HTML 画廊，浏览器里直接比。');
  return lines.join(String.fromCharCode(10));
}

// ── 参数化背景 ────────────────────────────────────────────────
function pickColors(entry, colors) {
  const defaults = entry.defaults || {};
  const list = Array.isArray(colors) ? colors.filter(Boolean).map(String) : [];
  return {
    c1: list[0] || defaults.c1 || '#7c3aed',
    c2: list[1] || defaults.c2 || '#06b6d4',
    c3: list[2] || defaults.c3 || '#f472b6',
    base: list[3] || defaults.base || '#0b1020',
    size: defaults.size || '28px',
  };
}

export function generateBackground(input, colors) {
  let entry = input;
  if (typeof input === 'string') {
    entry = { id: input, name: input, css: input.includes('{c1}') ? input : '', defaults: {} };
    if (!entry.css) throw new Error('不认识这个背景预设：' + input);
  }
  if (!entry || !entry.css) throw new Error('背景预设缺 css 模板');
  const vars = pickColors(entry, colors);
  let css = entry.css;
  for (const [key, value] of Object.entries(vars)) css = css.split('{' + key + '}').join(value);
  return { id: entry.id, name: entry.name, css, vars, extra: entry.extra || '' };
}

// ── 品牌套件 ──────────────────────────────────────────────────
const PALETTES = [
  { id: 'ink', name: '墨蓝 · 稳重科技', bg: '#0b1020', surface: '#151b2e', text: '#f8fafc', muted: '#94a3b8', accent: '#6366f1', accent2: '#22d3ee', dark: true },
  { id: 'warm', name: '暖纸 · 编辑手作', bg: '#faf7f2', surface: '#fffdf9', text: '#1c1917', muted: '#78716c', accent: '#ea580c', accent2: '#ca8a04', dark: false },
  { id: 'forest', name: '森野 · 自然有机', bg: '#f0fdf4', surface: '#ffffff', text: '#052e16', muted: '#4d7c5f', accent: '#059669', accent2: '#84cc16', dark: false },
  { id: 'candy', name: '糖果 · 年轻活动', bg: '#fdf4ff', surface: '#ffffff', text: '#1e1b4b', muted: '#7e6b9a', accent: '#d946ef', accent2: '#fb7185', dark: false },
  { id: 'mono', name: '黑白 · 极简编辑', bg: '#ffffff', surface: '#f4f4f5', text: '#111111', muted: '#71717a', accent: '#2563eb', accent2: '#111111', dark: false },
];

const PAIRINGS = [
  { id: 'editorial', name: '编辑感', display: "'Fraunces', Georgia, serif", text: "'Inter', system-ui, sans-serif", note: '衬线大标题 + 无衬线正文，最稳的高级感' },
  { id: 'tech', name: '科技感', display: "'Space Grotesk', system-ui, sans-serif", text: "'Inter', system-ui, sans-serif", note: '几何标题 + 中性正文，SaaS/AI 通用' },
  { id: 'swiss', name: '瑞士国际', display: "'Archivo', system-ui, sans-serif", text: "'Public Sans', system-ui, sans-serif", note: '网格、左对齐、少装饰' },
  { id: 'humanist', name: '人文友好', display: "'Instrument Serif', Georgia, serif", text: "'Manrope', system-ui, sans-serif", note: '优雅标题 + 圆润正文，适合教育/健康' },
  { id: 'cjk', name: '中文优先', display: "'Noto Serif SC', serif", text: "'Noto Sans SC', system-ui, sans-serif", note: '中文标题用宋、正文用黑；西文回退 Inter' },
];

function hashPick(list, seed) {
  let h = 2166136261;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[Math.abs(h) % list.length];
}

export function brandKit(options = {}) {
  const theme = String(options.theme || options.mood || '').trim();
  if (!theme) throw new Error('要给一个主题词（theme），例如 "咖啡品牌官网"');
  const lower = theme.toLowerCase();
  const forced = String(options.palette || '').toLowerCase();
  const darkWanted = options.dark === true || /暗|黑|夜色|科技|游戏|night|dark/.test(theme);
  let palette = PALETTES.find((p) => p.id === forced);
  if (!palette) {
    const keyword = /咖啡|茶|烘焙|餐厅|手作|面包|暖|婚礼|家庭/.test(theme) ? 'warm'
      : /自然|森林|环保|健康|园艺|农场|瑜伽|户外/.test(theme) ? 'forest'
      : /儿童|活动|音乐|派对|糖果|年轻|潮玩|节日/.test(theme) ? 'candy'
      : /极简|杂志|画廊|摄影|建筑|黑白|编辑/.test(theme) ? 'mono'
      : /科技|AI|SaaS|数据|云|安全|游戏|夜/.test(theme) ? 'ink' : '';
    palette = PALETTES.find((p) => p.id === keyword);
  }
  if (!palette) {
    if (darkWanted) palette = hashPick(PALETTES.filter((p) => p.dark), theme);
    else palette = hashPick(PALETTES.filter((p) => !p.dark), theme);
  }
  const pair = PAIRINGS.find((p) => p.id === String(options.pairing || '').toLowerCase()) || (palette.id === 'ink' ? PAIRINGS[1] : /中文|国风|书|杂志|报纸/.test(theme) ? PAIRINGS[4] : hashPick(PAIRINGS, theme + 'pair'));
  const radius = /圆|可爱|儿童|玩具/.test(theme) ? 16 : /极简|瑞士|工业|硬/.test(theme) ? 4 : 10;
  const density = /紧凑|仪表盘|数据|dashboard/.test(lower) ? 0.75 : /杂志|海报|留白/.test(theme) ? 1.35 : 1;
  const tokens = {
    color: { bg: palette.bg, surface: palette.surface, text: palette.text, muted: palette.muted, accent: palette.accent, accent2: palette.accent2 },
    font: { display: pair.display, text: pair.text },
    radius: { sm: radius / 2, md: radius, lg: radius * 1.8, pill: 999 },
    space: { 1: 4 * density, 2: 8 * density, 3: 12 * density, 4: 16 * density, 6: 24 * density, 8: 32 * density, 12: 48 * density, 16: 64 * density },
    text: { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '24px', '2xl': '30px', '3xl': '40px', '4xl': 'clamp(40px, 7vw, 64px)' },
    shadow: {
      sm: '0 1px 2px rgba(15,23,42,.08)',
      md: '0 6px 20px rgba(15,23,42,.10)',
      lg: '0 24px 60px rgba(15,23,42,.18)',
    },
  };
  const cssVars = [
    ':root{',
    '  --bg:' + palette.bg + ';--surface:' + palette.surface + ';--text:' + palette.text + ';--muted:' + palette.muted + ';',
    '  --accent:' + palette.accent + ';--accent-2:' + palette.accent2 + ';',
    '  --font-display:' + pair.display + ';--font-text:' + pair.text + ';',
    '  --r-sm:' + tokens.radius.sm + 'px;--r-md:' + tokens.radius.md + 'px;--r-lg:' + tokens.radius.lg + 'px;--r-pill:999px;',
    '  --s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-6:24px;--s-8:32px;--s-12:48px;--s-16:64px;',
    '  --shadow-sm:' + tokens.shadow.sm + ';--shadow-md:' + tokens.shadow.md + ';--shadow-lg:' + tokens.shadow.lg + ';',
    '}',
    'body{background:var(--bg);color:var(--text);font-family:var(--font-text);}',
    'h1,h2,h3{font-family:var(--font-display);letter-spacing:-.02em;line-height:1.08;}',
  ].join(String.fromCharCode(10));
  const iconStyle = darkWanted ? '线性图标 1.5px + 单色 var(--accent)；避免多色 emoji 混排' : '线性或实心统一一种；图标尺寸 16/20/24 三档';
  const decorStyle = palette.id === 'warm' ? '纸纹 + 胶带 + 手绘圈注（少量）' : palette.id === 'candy' ? '贴纸描边 + 爆炸星标 + 圆角卡片' : palette.id === 'ink' ? '细网格 + 光球 + 细边框，别用贴纸' : '极细线框 + 大留白，装饰只做分隔';
  const motionBudget = /游戏|活动|音乐/.test(theme) ? '允许多段动效，但同屏 ≤2 个循环动画' : '一屏一次入场 + 一次悬停反馈；循环动效最多 1 个';
  return { theme, palette, pairing: pair, tokens, cssVars, iconStyle, decorStyle, motionBudget };
}

// ── 字体 ──────────────────────────────────────────────────────
export function searchFonts(lib, options = {}) {
  const query = String(options.query || '').toLowerCase();
  const source = options.source ? String(options.source).toLowerCase() : '';
  const category = options.category ? String(options.category) : '';
  const cjkOnly = options.cjk === true;
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, MAX_SEARCH_LIMIT));
  const rows = lib.fonts.filter((f) => {
    if (source && String(f.source).toLowerCase() !== source) return false;
    if (category && f.category !== category) return false;
    if (cjkOnly && !f.cjk) return false;
    if (!query) return true;
    const hay = [f.family, f.category, (f.tags || []).join(' '), f.note || '', f.license || ''].join(' ').toLowerCase();
    return query.split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
  });
  return { total: rows.length, rows: rows.slice(0, limit) };
}

function slugFont(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function googleFontCssUrl(family, options = {}) {
  const fam = String(family).trim().replace(/\s+/g, '+');
  let weights = '';
  const raw = options.weights;
  if (Array.isArray(raw) && raw.length) weights = 'wght@' + raw.join(';');
  else if (typeof raw === 'string' && raw.trim()) {
    if (/\.\./.test(raw)) weights = 'wght@' + raw.replace(/\s/g, '');
    else {
      const nums = raw.match(/\d{3}/g);
      if (nums && nums.length) weights = 'wght@' + [...new Set(nums)].join(';');
    }
  }
  const params = ['family=' + fam + (weights ? ':' + weights : '')];
  if (options.display !== false) params.push('display=swap');
  if (options.subset) params.push('subset=' + encodeURIComponent(options.subset));
  if (options.text) params.push('text=' + encodeURIComponent(options.text));
  return GOOGLE_FONTS_CSS + '?' + params.join('&');
}

export function fontshareCssUrl(family, options = {}) {
  const slug = slugFont(family);
  let weights = '400';
  const raw = options.weights;
  if (Array.isArray(raw) && raw.length) weights = raw.join(',');
  else if (typeof raw === 'string' && raw.trim()) {
    const nums = raw.match(/\d{3}/g);
    if (nums && nums.length) weights = [...new Set(nums)].join(',');
  }
  return FONTSHARE_API + '/css?f[]=' + slug + '@' + weights + '&display=swap';
}

export function fontCss(input = {}) {
  const family = String(input.family || '').trim();
  if (!family) throw new Error('要给 family，例如 family="Inter"');
  const source = String(input.source || 'google').toLowerCase();
  const weights = input.weights;
  if (source === 'google') {
    const url = googleFontCssUrl(family, { weights, display: input.display, subset: input.subset, text: input.text });
    return {
      source,
      family,
      url,
      link: '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' + String.fromCharCode(10) + '<link rel="stylesheet" href="' + url + '">',
      css: "@import url('" + url + "');" + String.fromCharCode(10) + "body{font-family:'" + family + "',system-ui,-apple-system,'Noto Sans SC',sans-serif;}",
      note: 'Google 的 css2 会按 unicode-range 拆成很多 @font-face 子集，中文只下载用到的字块；要更省就传 text= 指定字符。',
    };
  }
  if (source === 'fontshare') {
    const url = fontshareCssUrl(family, { weights });
    return {
      source,
      family,
      url,
      link: '<link rel="stylesheet" href="' + url + '">',
      css: "@import url('" + url + "');" + String.fromCharCode(10) + "body{font-family:'" + family + "',system-ui,sans-serif;}",
      note: 'Fontshare 的 CSS 接口同样支持 variable 轴；商用前确认具体字体的 ITF FFL 条款。',
    };
  }
  if (source === 'fontsource') {
    const id = slugFont(family);
    return {
      source,
      family,
      url: 'https://cdn.jsdelivr.net/npm/@fontsource/' + id + '/index.css',
      link: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/' + id + '/index.css">',
      css: "@import '@fontsource/" + id + "'; /* 自托管：npm i @fontsource/" + id + " */",
      note: 'Fontsource 适合自托管，不依赖第三方 CDN；jsDelivr 在部分网络环境会被重置，装到本地最稳。',
    };
  }
  if (source === 'system' || source === 'local') {
    return {
      source: 'system',
      family,
      url: '',
      link: '',
      css: "body{font-family:'" + family + "',system-ui,-apple-system,'Segoe UI','Noto Sans SC',sans-serif;}",
      note: '本地/系统字体：用户机器上没装就会回退。做交付物时把字体文件一起给，或用 @font-face 自托管。',
    };
  }
  throw new Error('不认识的字体源：' + source + '（可选 google / fontshare / fontsource / system）');
}

async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'dsh-anim-pack/1.1 (+https://github.com/Liaoyun666/dsh-art)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyGoogleFont(family, options = {}) {
  const url = googleFontCssUrl(family, { weights: options.weights });
  const text = await fetchText(url);
  const faces = (text.match(/@font-face/g) || []).length;
  if (!faces) throw new Error('Google Fonts 没返回 @font-face（字体名可能拼错）');
  const subsets = [...new Set((text.match(/unicode-range/g) || []).length ? ['unicode-range'] : [])];
  return { ok: true, family, url, faces, note: subsets.length ? '按 unicode-range 拆分 ' + faces + ' 个子集' : faces + ' 个 @font-face' };
}

let fontshareCache = null;
export async function listFontshare(options = {}) {
  const max = Math.min(Number(options.pages) || 3, 6);
  if (fontshareCache && Date.now() - fontshareCache.at < 6 * 3600 * 1000) return fontshareCache.rows;
  const rows = [];
  for (let page = 0; page < max; page += 1) {
    const data = await fetchJson(FONTSHARE_API + '/fonts?limit=100&offset=' + page * 100);
    for (const f of data.fonts || []) {
      rows.push({ family: f.name, source: 'fontshare', category: String(Array.isArray(f.category) ? f.category[0] : (f.category || 'sans')).toLowerCase(), weights: (f.styles || []).map((s) => s.weight).filter(Boolean).join(' / ') || '400', license: 'ITF FFL', tags: ['fontshare'], note: (f.description || '').slice(0, 80) });
    }
    if (!data.has_more) break;
  }
  fontshareCache = { at: Date.now(), rows };
  return rows;
}

export async function fontsourceInfo(id) {
  const data = await fetchJson('https://api.fontsource.org/v1/fonts/' + encodeURIComponent(id));
  return {
    id: data.id || id,
    family: data.family || id,
    weights: data.weights || [],
    styles: data.styles || [],
    subsets: data.subsets || [],
    variable: !!data.variable,
    license: data.license || '',
    source: 'fontsource',
  };
}

// ── 图标组 ────────────────────────────────────────────────────
export const ICON_GROUPS = [
  { id: 'ui', name: '界面线性', prefixes: ['lucide', 'ph', 'tabler'], stroke: '1.5–2px 线性', when: '后台/工具/仪表盘，最百搭' },
  { id: 'solid', name: '界面实心', prefixes: ['mdi', 'material-symbols', 'ph-fill'], stroke: '实心填充', when: '小尺寸（16–20px）更清楚，移动端 tabbar' },
  { id: 'game', name: '游戏图标', prefixes: ['game-icons'], stroke: '剪影/线稿', when: '血条、技能、装备、成就' },
  { id: 'brand', name: '品牌 Logo', prefixes: ['simple-icons', 'logos'], stroke: '单色/多色 logo', when: '合作方墙、登录方式、社交' },
  { id: 'emoji', name: '彩色表情', prefixes: ['twemoji', 'noto'], stroke: '彩色', when: '轻松场景、空状态；别和线性图标混排' },
  { id: 'arrows', name: '箭头方向', prefixes: ['lucide', 'tabler', 'mdi'], stroke: '线性/实心', when: '流程、轮播、返回、外链' },
];

export async function searchIconGroup(group, options = {}) {
  const def = ICON_GROUPS.find((g) => g.id === group) || ICON_GROUPS.find((g) => g.name === group);
  if (!def) throw new Error('不认识的图标组：' + group + '（可选 ' + ICON_GROUPS.map((g) => g.id).join(' / ') + '）');
  const query = String(options.query || '').trim();
  if (!query) throw new Error('要给 query，例如 query="rocket"');
  const limit = Math.max(1, Math.min(Number(options.limit) || 12, 48));
  const per = Math.max(2, Math.ceil(limit / def.prefixes.length));
  const rows = [];
  for (const prefix of def.prefixes) {
    try {
      const data = await fetchJson(ICONIFY_API + '/search?query=' + encodeURIComponent(query) + '&prefix=' + encodeURIComponent(prefix) + '&limit=' + per);
      for (const icon of data.icons || []) rows.push({ icon, prefix, name: icon.split(':')[1] });
    } catch {
      // 单个集挂了不影响其他集
    }
    if (rows.length >= limit) break;
  }
  return { group: def, query, rows: rows.slice(0, limit), total: rows.length };
}

export function iconSvgUrl(icon, options = {}) {
  const [prefix, name] = String(icon).split(':');
  if (!prefix || !name) throw new Error('图标 id 形如 lucide:rocket');
  const size = options.height || 24;
  const color = options.color ? '&color=' + encodeURIComponent(options.color.replace('#', '%23')) : '';
  return ICONIFY_API + '/' + prefix + '/' + name + '.svg?height=' + size + color;
}


export async function fetchIconFiles(icons, options = {}) {
  const dir = String(options.dir || '').trim();
  if (!dir) throw new Error('要给落盘目录 dir');
  mkdirSync(dir, { recursive: true });
  const rows = [];
  for (const icon of icons) {
    try {
      const svg = await fetchText(iconSvgUrl(icon, options));
      const name = String(icon).replace(':', '__') + '.svg';
      const file = join(dir, name);
      writeFileSync(file, svg, 'utf8');
      rows.push({ icon, file, bytes: Buffer.byteLength(svg, 'utf8') });
    } catch (error) {
      rows.push({ icon, error: String(error && error.message ? error.message : error) });
    }
  }
  return rows;
}

// ── 排版体检 ──────────────────────────────────────────────────
export const TYPOGRAPHY_RULES = [
  { id: 'scale', name: '字号阶梯 ≤5 档', check: '数页面里出现过的 font-size 种类', fix: '12/14/16/20/28/40 这类固定阶梯，别出现 17px、23px', severity: 2 },
  { id: 'line-height', name: '正文行高 1.5–1.7', check: '正文 line-height', fix: '中文正文 1.65–1.8；标题 1.05–1.2；别全站一个值', severity: 2 },
  { id: 'measure', name: '长文宽度 45–75 字符', check: 'max-width / ch', fix: '正文容器 max-width: 65ch（中文约 34–38 字/行）', severity: 2 },
  { id: 'tracking', name: '大标题负字距', check: '标题 letter-spacing', fix: '-0.02em 到 -0.04em；小字与全大写相反要加正字距', severity: 1 },
  { id: 'weights', name: '字重 ≤3 种', check: '用过的 font-weight', fix: '400 / 500 / 700 三档够用；900 只给 hero', severity: 1 },
  { id: 'cjk-space', name: '中西混排留白', check: '中文与英文/数字之间', fix: '加空格（或 CSS text-spacing-trim / word-break 处理），别让它们贴死', severity: 1 },
  { id: 'nums', name: '数字等宽', check: '表格/价格/比分', fix: 'font-variant-numeric: tabular-nums', severity: 2 },
  { id: 'contrast', name: '文字对比 ≥4.5:1', check: '正文/次要文字与底色', fix: '灰字别低于 #6b7280（白底）；用工具量，不靠眼睛', severity: 3 },
  { id: 'min-size', name: '最小字号 12px（移动 14px）', check: '辅助文字', fix: '11px 以下只允许装饰性英文标签', severity: 1 },
  { id: 'punctuation', name: '标点全半角统一', check: '中英文标点混用', fix: '中文正文用全角，代码/英文用半角；别一句里混', severity: 1 },
  { id: 'kinsoku', name: '避头尾', check: '行首出现 。，、）》', fix: 'CSS line-break: strict；必要时手动 &nbsp;', severity: 2 },
  { id: 'uppercase', name: '全大写字距', check: 'UPPERCASE 标签', fix: 'letter-spacing: .08em–.14em，否则挤成一坨', severity: 1 },
  { id: 'align', name: '长文别居中', check: '段落 text-align', fix: '超过 2 行就左对齐；居中只给标题/短句', severity: 1 },
  { id: 'link', name: '链接不只靠颜色', check: '正文内链接', fix: '下划线或字重变化 + 颜色，满足非颜色通道', severity: 2 },
  { id: 'fallback', name: '字体回退链完整', check: 'font-family', fix: "每个自定义字体后面都跟 system-ui / 'Noto Sans SC' / serif 兜底", severity: 2 },
];

export function typeAudit(options = {}) {
  const scope = String(options.scope || '').trim();
  const rows = TYPOGRAPHY_RULES.map((r) => ({ ...r }));
  const bySeverity = rows.reduce((acc, r) => { acc[r.severity] = (acc[r.severity] || 0) + 1; return acc; }, {});
  return { scope, rules: rows, bySeverity, total: rows.length };
}

// ── 导出 HTML 画廊 ────────────────────────────────────────────
function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function exportTypeGallery(lib, options = {}) {
  const dir = String(options.dir || '').trim();
  if (!dir) throw new Error('要给导出目录 dir');
  const ids = Array.isArray(options.ids) ? options.ids.map(String) : [];
  const kind = options.kind ? String(options.kind) : '';
  let entries = [];
  if (ids.length) {
    for (const id of ids) {
      const found = resolveType(lib, id);
      if (found.entry) entries.push(found.entry);
    }
    if (!entries.length) throw new Error('给的 id 一个都没找到：' + ids.join(', '));
  } else {
    const pool = [];
    if (!kind || kind === 'effect') pool.push(...lib.effects);
    if (!kind || kind === 'motion') pool.push(...lib.motion);
    if (!kind || kind === 'decor') pool.push(...lib.decor);
    if (!kind || kind === 'background') pool.push(...lib.background);
    entries = pool;
  }
  mkdirSync(dir, { recursive: true });
  const cards = entries.map((entry) => {
    let preview = '';
    if (entry.kind === 'background') {
      const gen = generateBackground(entry);
      preview = '<div style="height:180px;' + gen.css + '"></div>';
    } else if (entry.html) {
      const doc = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#f4f4f5;font-family:system-ui,sans-serif}' + entry.css + '</style>' + entry.html;
      preview = '<iframe scrolling="no" style="width:100%;height:180px;border:0;background:#f4f4f5" srcdoc="' + esc(doc) + '"></iframe>';
    }
    return '<article><h3>' + esc(entry.name) + ' <small>' + esc(entry.kind) + '</small></h3>' +
      '<p class="when">' + esc(entry.when || '') + '</p>' +
      preview +
      '<details><summary>HTML / CSS</summary><pre>' + esc((entry.html ? entry.html + String.fromCharCode(10) + String.fromCharCode(10) : '') + (entry.kind === 'background' ? generateBackground(entry).css : entry.css)) + '</pre></details>' +
      (entry.pitfall ? '<p class="pit">坑：' + esc(entry.pitfall) + '</p>' : '') +
      '</article>';
  }).join(String.fromCharCode(10));
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + esc(options.title || 'dsh-anim-pack 文字与美化画廊') + '</title>' +
    '<style>body{margin:0;padding:32px;background:#fafafa;color:#111;font-family:system-ui,sans-serif}h1{font-size:22px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}article{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:16px}h3{margin:0 0 6px;font-size:15px}h3 small{font-weight:400;color:#71717a}.when{margin:0 0 10px;font-size:12px;color:#52525b;line-height:1.5}.pit{margin:8px 0 0;font-size:12px;color:#b45309}pre{white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.5;background:#f4f4f5;padding:10px;border-radius:8px;max-height:240px;overflow:auto}details{margin-top:10px;font-size:12px}</style>' +
    '<h1>' + esc(options.title || '文字与美化画廊') + '</h1><p style="color:#71717a;font-size:13px">共 ' + entries.length + ' 条 · 每条都是独立 iframe，互不污染</p><main>' + cards + '</main></html>';
  const file = join(dir, 'gallery.html');
  writeFileSync(file, html, 'utf8');
  return { file, count: entries.length, ids: entries.map((e) => e.id) };
}
