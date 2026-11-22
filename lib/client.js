// dsh-anim-pack — 浏览器端工具卡片。
//
// 31 个 anim_* 工具原本都落到宿主的通用行：图标是一颗火花，标题写死「工具调用」，
// 摘要是一串 args JSON（绝大多数是 "{}"），展开后是整段纯文本。素材包里真正好看的
// 东西——预览拼图、镜头卡海报、参考图缩略图、风格静帧——全埋在那段文本的绝对路径里。
//
// 这里用宿主的 tool.call.toolview 插槽（按 wire name 分派、key 命中即替换通用行）给每个
// 工具注册一张自己的卡片：
//   · 行：家族图标 + 中文标题 + 关键参数 chip + 结果规模 chip（几张图）；
//   · 展开：参数 chips、图片墙（走 /api/file?path=… 的鉴权读盘接口，本地路径直接出图）、
//     正文（路径自动变成可点开的链接，过长可继续展开）。
//
// 一个坑记在这里：keyed 视图是「整行替换」，所以每张卡片必须自己覆盖准备中 / 运行中 /
// 失败 / 取消这些形态，不能只在有结果时好看。

window.__ModuleLoader__.load({
	id: "dsh-anim-pack",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		//#region 工具目录
		const TOOLS = {
			anim_search: ["style", "检索风格", "🔍"],
			anim_show: ["style", "风格详情", "📄"],
			anim_still: ["style", "风格静帧", "🖼"],
			anim_random: ["style", "随机风格", "🎲"],
			anim_list_series: ["style", "素材系列", "🗂"],
			anim_export: ["style", "导出风格", "📦"],
			anim_fx_stats: ["fx", "特效库概况", "📊"],
			anim_fx_search: ["fx", "检索特效", "🔍"],
			anim_fx_show: ["fx", "特效详情", "📄"],
			anim_fx_preview: ["fx", "特效预览图", "🎞"],
			anim_fx_random: ["fx", "随机特效", "🎲"],
			anim_fx_export: ["fx", "导出特效", "📦"],
			anim_fx_guide: ["guide", "特效用法", "📘"],
			anim_ref_sources: ["ref", "参考图库", "🗂"],
			anim_ref_search: ["ref", "检索参考图", "🔍"],
			anim_ref_show: ["ref", "参考图详情", "🖼"],
			anim_ref_pick: ["ref", "随机参考图", "🎲"],
			anim_extract: ["extract", "元素提取", "🧩"],
			anim_extract_guide: ["guide", "元素提取说明", "📘"],
			anim_shot_stats: ["shot", "镜头卡概况", "📊"],
			anim_shot_search: ["shot", "检索镜头卡", "🔍"],
			anim_shot_show: ["shot", "镜头卡详情", "🎬"],
			anim_shot_preview: ["shot", "镜头卡海报", "🖼"],
			anim_shot_random: ["shot", "随机镜头卡", "🎲"],
			anim_shot_export: ["shot", "导出镜头卡", "📦"],
			anim_shot_guide: ["guide", "镜头卡用法", "📘"],
			anim_design_brief: ["design", "设计参考包", "🎨"],
			anim_design_anchors: ["design", "美学锚点", "🎨"],
			anim_design_patterns: ["design", "版式模式", "🧱"],
			anim_design_audit: ["design", "设计自检", "✅"],
			anim_asset_sources: ["asset", "外接素材库", "🗄"],
			anim_asset_search: ["asset", "检索素材", "🔍"],
			anim_asset_show: ["asset", "素材详情", "🖼"],
			anim_asset_fetch: ["asset", "下载素材", "⬇"],
			anim_asset_guide: ["guide", "素材库用法", "📘"],
			anim_guide: ["guide", "动画指南", "📘"]
		};
		//#endregion

		//#region 结果解析
		const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;
		const MAX_IMAGES = 12;
		const MAX_BODY = 14000;

		function isAbsolutePath(text) {
			return /^[A-Za-z]:[\\/]/.test(text) || (text.charAt(0) === "/" && text.length > 2 && text.charAt(1) !== "/");
		}

		function trimToken(text) {
			return text.replace(/^[\u0060*"'\[({<]+/, "").replace(/[\u0060*"'\])}>.,;:!?，。；：、]+$/, "");
		}

		function resultText(block) {
			if (!block || !Array.isArray(block.content)) return "";
			const parts = [];
			for (const item of block.content) {
				if (item && item.type === "text") parts.push(item.text);
				else parts.push(JSON.stringify(item, null, 2));
			}
			if (parts.length === 0 && block.error) parts.push(block.error.name + ": " + block.error.code);
			return parts.join("\n");
		}

		// 路径常常紧贴在中文标点后面（"预览拼图：C:\Temp\a.png"），所以不做分词，
		// 直接用正则从整段文本里捞绝对路径，再按扩展名筛图片。
		const FILE_RE = /[A-Za-z]:[\\/][^\s"\x27\u0060<>|*?\[\]{}(),;，。；、：]+|\/(?:[^\s"\x27\u0060<>|*?\[\]{}(),;，。；、：]+\/)+[^\s"\x27\u0060<>|*?\[\]{}(),;，。；、：]+/g;

		// https://host/x.png 会被"盘符"分支误认成 s://host/x.png，先排除。
		function looksLikeUrl(token) {
			return token.indexOf("://") !== -1;
		}

		function trimPunct(token) {
			let out = token;
			while (out.length > 0 && ".,;:".indexOf(out.charAt(out.length - 1)) !== -1) out = out.slice(0, -1);
			return out;
		}

		function pickImages(text) {
			const seen = Object.create(null);
			const list = [];
			FILE_RE.lastIndex = 0;
			let match = FILE_RE.exec(text);
			while (match !== null) {
				const token = trimPunct(match[0]);
				if (token.length >= 4 && isAbsolutePath(token) && !looksLikeUrl(token) && IMAGE_EXT.test(token) && !seen[token]) {
					seen[token] = true;
					list.push(token);
					if (list.length >= MAX_IMAGES) break;
				}
				match = FILE_RE.exec(text);
			}
			return list;
		}

		// 摘要优先用第一行有内容的文字，标题符号（## / - / >）和结尾冒号都剥掉。
		function headline(text) {
			const lines = text.split("\n");
			for (const raw of lines) {
				const line = raw.replace(/^[\s#>*\-]+/, "").replace(/[\s:：]+$/, "");
				if (line.length >= 2) return line.length > 90 ? line.slice(0, 90) + "…" : line;
			}
			return "";
		}

		const ARG_ORDER = ["ids", "id", "query", "name", "series", "category", "target", "path", "dir", "kind", "at"];

		function parseArgs(raw) {
			if (typeof raw !== "string" || raw === "" || raw === "{}") return null;
			try {
				const value = JSON.parse(raw);
				if (value && typeof value === "object" && !Array.isArray(value)) return value;
				return null;
			} catch (err) {
				return null;
			}
		}

		function argsSummary(args) {
			if (!args) return "";
			for (const key of ARG_ORDER) {
				const value = args[key];
				if (value === undefined || value === null || value === "") continue;
				if (Array.isArray(value)) return value.slice(0, 3).join("、") + (value.length > 3 ? " 等 " + value.length + " 个" : "");
				return String(value);
			}
			const keys = Object.keys(args);
			if (keys.length === 0) return "";
			const first = args[keys[0]];
			return keys[0] + ": " + (typeof first === "object" ? "…" : String(first));
		}

		function argChips(args) {
			if (!args) return [];
			const chips = [];
			for (const key of Object.keys(args)) {
				const value = args[key];
				if (value === undefined || value === null || value === "") continue;
				const text = Array.isArray(value) ? value.join("、") : typeof value === "object" ? JSON.stringify(value) : String(value);
				chips.push([key, text]);
			}
			return chips;
		}
		//#endregion

		//#region 样式
		// 全部走宿主 token，明暗主题自动跟着变；没有任何硬编码底色。
		const CSS = [
			'.dap-root{font-size:var(--dsh-content-font-size-secondary,12px);line-height:1.65;min-width:0}',
			'.dap-row{display:flex;align-items:center;gap:6px;min-height:24px;padding:0 4px;margin:0 -4px;border-radius:6px;cursor:pointer;user-select:none}',
			'.dap-row:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.12))}',
			'.dap-row:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:-2px}',
			'.dap-ico{flex:none;width:16px;text-align:center;font-size:13px;line-height:1}',
			'.dap-title{flex:none;font-weight:500;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit)}',
			'.dap-sep{flex:none;opacity:.45;color:var(--dsw-alias-label-tertiary,currentColor)}',
			'.dap-sum{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:.92em}',
			'.dap-chip{flex:none;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:999px;font-size:.85em;line-height:16px;color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap}',
			'.dap-chip-ok{color:var(--dsw-alias-state-success-primary,#30a46c);border-color:currentColor}',
			'.dap-chip-err{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:currentColor}',
			'.dap-chev{flex:none;margin-left:2px;font-size:10px;color:var(--dsw-alias-label-tertiary,currentColor);transition:transform .16s ease}',
			'.dap-row[aria-expanded="true"] .dap-chev{transform:rotate(90deg)}',
			'.dap-body{display:flex;flex-direction:column;gap:8px;margin:4px 0 8px 7px;padding-left:11px;border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))}',
			'.dap-kvs{display:flex;flex-wrap:wrap;gap:4px 6px}',
			'.dap-kv{display:inline-flex;align-items:baseline;gap:5px;max-width:100%;padding:1px 7px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:6px;background:var(--dsw-alias-bg-base,rgba(127,127,127,.06))}',
			'.dap-kv-k{flex:none;font-size:.85em;color:var(--dsw-alias-label-tertiary,inherit)}',
			'.dap-kv-v{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:.9em;color:var(--dsw-alias-label-primary,inherit)}',
			'.dap-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}',
			'.dap-thumb{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base,rgba(127,127,127,.06));cursor:pointer}',
			'.dap-thumb:hover{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.5))}',
			'.dap-thumb img{display:block;width:100%;height:100%;object-fit:cover}',
			'.dap-text{max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:.95em;color:var(--dsw-alias-label-secondary,inherit)}',
			'.dap-text-err{color:var(--dsw-alias-state-error-primary,#e5484d)}',
			'.dap-link{color:var(--dsw-alias-label-primary,inherit);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;cursor:pointer}',
			'.dap-link:hover{text-decoration-style:solid}',
			'.dap-more{align-self:flex-start;padding:0;border:none;background:none;font:inherit;font-size:.9em;color:var(--dsw-alias-label-secondary,inherit);text-decoration:underline;cursor:pointer}'
		].join("\n");

		function injectStyles(ctx) {
			ctx.effect(() => {
				const styleNode = document.createElement("style");
				styleNode.dataset.plugin = "dsh-anim-pack";
				styleNode.textContent = CSS;
				document.head.appendChild(styleNode);
				return () => styleNode.remove();
			}, "dsh-anim-pack: styles");
		}
		//#endregion

		//#region 正文
		function isLinkable(token) {
			if (!isAbsolutePath(token) || looksLikeUrl(token)) return false;
			if (IMAGE_EXT.test(token)) return true;
			if (token.indexOf("\\") !== -1) return true;
			return token.split("/").length > 2;
		}

		// 正文里的绝对路径（预览图、拼图、导出目录）都是能直接打开的，就别让人手动复制。
		function renderText(text, onOpen) {
			const nodes = [];
			let last = 0;
			let index = 0;
			FILE_RE.lastIndex = 0;
			let match = FILE_RE.exec(text);
			while (match !== null) {
				const token = match[0];
				if (isLinkable(token)) {
					if (match.index > last) nodes.push(text.slice(last, match.index));
					nodes.push(h("span", {
						key: "lnk" + index++,
						className: "dap-link",
						role: "link",
						tabIndex: 0,
						title: token,
						onClick: () => { if (onOpen) onOpen(token); },
					}, token));
					last = match.index + token.length;
				}
				match = FILE_RE.exec(text);
			}
			if (last < text.length) nodes.push(text.slice(last));
			return nodes;
		}

		function ImageWall(props) {
			const [broken, setBroken] = React.useState({});
			const images = props.images.filter((src) => !broken[src]);
			if (images.length === 0) return null;
			return h("div", { className: "dap-wall" }, images.map((src) => h("div", {
				key: src,
				className: "dap-thumb",
				role: "button",
				tabIndex: 0,
				title: src,
				onClick: () => { if (props.onOpen) props.onOpen(src); },
			}, h("img", {
				src: "/api/file?path=" + encodeURIComponent(src),
				alt: "",
				loading: "lazy",
				onError: () => setBroken((prev) => { const next = Object.assign({}, prev); next[src] = true; return next; }),
			}))));
		}

		function AnimBody(props) {
			const [full, setFull] = React.useState(false);
			const text = props.text;
			const chips = argChips(props.args);
			const truncated = !full && text.length > MAX_BODY;
			const shown = truncated ? text.slice(0, MAX_BODY) : text;
			return h("div", { className: "dap-body" },
				chips.length > 0 ? h("div", { className: "dap-kvs" }, chips.map((pair) => h("span", {
					key: pair[0],
					className: "dap-kv",
					title: pair[0] + ": " + pair[1],
				}, h("span", { className: "dap-kv-k" }, pair[0]), h("span", { className: "dap-kv-v" }, pair[1])))) : null,
				props.images.length > 0 ? h(ImageWall, { images: props.images, onOpen: props.onOpen }) : null,
				text ? h("div", { className: "dap-text" + (props.isError ? " dap-text-err" : "") }, renderText(shown, props.onOpen)) : null,
				truncated ? h("button", { className: "dap-more", onClick: () => setFull(true) }, "展开全部（共 " + text.length + " 字）") : null
			);
		}
		//#endregion

		//#region 行与注册
		function AnimToolView(props) {
			const meta = TOOLS[props.toolName] || ["other", props.toolName, "🔧"];
			const block = props.block;
			// 运行中的 block 还没有 kind，argsRaw 在顶层；结算后 argsRaw 挪到 call 里。
			const settled = !!block && block.kind === "tool-result";
			const argsRaw = block ? (settled ? (block.call && block.call.argsRaw) : block.argsRaw) : "";
			const [manual, setManual] = React.useState(null);
			const text = settled ? resultText(block) : "";
			const args = parseArgs(argsRaw);
			const images = React.useMemo(() => (text ? pickImages(text) : []), [text]);
			const failed = settled && !!block.isError;
			const open = manual === null ? failed : manual;

			let summary = "";
			if (!settled) summary = "运行中…";
			else {
				summary = argsSummary(args);
				if (!summary) summary = headline(text);
			}

			const toggle = () => setManual(!open);

			return h("div", { className: "dap-root", "data-tool": props.toolName, "data-state": failed ? "error" : settled ? "ok" : "running" },
				h("div", {
					className: "dap-row",
					role: "button",
					tabIndex: 0,
					"aria-expanded": open ? "true" : "false",
					title: props.toolName,
					onClick: toggle,
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
					},
				},
					h("span", { className: "dap-ico", "aria-hidden": "true" }, meta[2]),
					h("span", { className: "dap-title" }, meta[1]),
					summary ? h("span", { className: "dap-sep" }, "·") : null,
					summary ? h("span", { className: "dap-sum" }, summary) : null,
					images.length > 0 ? h("span", { className: "dap-chip" }, "图 " + images.length) : null,
					failed ? h("span", { className: "dap-chip dap-chip-err" }, "失败") : null,
					h("span", { className: "dap-chev", "aria-hidden": "true" }, "▸")
				),
				open ? h(AnimBody, { text: text, images: images, args: args, isError: failed, onOpen: props.openFile }) : null
			);
		}

		// 一个工具一个插件：key 命中就把通用行整行换掉。
		function viewPlugin(toolName) {
			return {
				name: "anim-toolview-" + toolName,
				inject: ["slots"],
				apply(ctx) {
					ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({ name: "tool.call.toolview", key: toolName }, AnimToolView));
				},
			};
		}

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			injectStyles(ctx);
			for (const toolName of Object.keys(TOOLS)) ctx.plugin(viewPlugin(toolName));
		};
		//#endregion

		return module.exports;
	}
});
