import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BoxClient } from 'box-node-sdk';
import { sdToJson } from 'box-node-sdk/lib/serialization/json';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';
import { getConnection } from '../utils/connectionStorage';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EnterpriseConfigCategory = 'security' | 'content_and_sharing' | 'user_settings' | 'shield';

const CATEGORY_LABELS: Record<EnterpriseConfigCategory, string> = {
	security: 'Security',
	content_and_sharing: 'Content & Sharing',
	user_settings: 'User Settings',
	shield: 'Shield',
};

const ALL_CATEGORIES: EnterpriseConfigCategory[] = [
	'security', 'content_and_sharing', 'user_settings', 'shield',
];

// ─── Panel state ────────────────────────────────────────────────────────────

let currentPanel: vscode.WebviewPanel | undefined;

// ─── Public API ─────────────────────────────────────────────────────────────

export async function openEnterpriseConfigDetail(
	focusCategory?: EnterpriseConfigCategory,
): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
		return;
	}

	const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
	const conn = alias ? await getConnection(alias) : undefined;
	const enterpriseId = conn?.enterpriseId;
	if (!enterpriseId) {
		vscode.window.showErrorMessage('No enterprise ID found. Re-authorize your connection.');
		return;
	}

	const title = 'Enterprise Configuration';

	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.One);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'boxEnterpriseConfigDetail',
			title,
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		currentPanel.onDidDispose(() => {
			currentPanel = undefined;
		});
	}

	// Show loading state
	const nonce = crypto.randomBytes(16).toString('hex');
	currentPanel.webview.html = getLoadingHtml(nonce);

	// Fetch all categories
	const configData = await fetchEnterpriseConfig(result.client, enterpriseId);

	if (!configData) {
		currentPanel.webview.html = getErrorHtml(nonce, 'Failed to fetch enterprise configuration.');
		return;
	}

	currentPanel.webview.html = getWebviewHtml(configData, enterpriseId, focusCategory, nonce);
}

// ─── API call ───────────────────────────────────────────────────────────────

async function fetchEnterpriseConfig(
	client: BoxClient,
	enterpriseId: string,
): Promise<Record<string, unknown> | null> {
	try {
		const categories = ALL_CATEGORIES.join(',');
		const url = `https://api.box.com/2.0/enterprise_configurations/${enterpriseId}`;

		const response = await client.makeRequest({
			method: 'GET',
			url,
			params: { categories },
			headers: { 'box-version': '2025.0' },
			responseFormat: 'json',
		});

		if (response.status !== 200) {
			log(ext.out, `[EnterpriseConfig] API returned status ${response.status}`);
			return null;
		}

		const json = JSON.parse(sdToJson(response.data!));
		return json as Record<string, unknown>;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[EnterpriseConfig] Failed to fetch: ${message}`);
		return null;
	}
}

// ─── HTML generation ────────────────────────────────────────────────────────

function getLoadingHtml(nonce: string): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<style nonce="${nonce}">
		body {
			font-family: var(--vscode-font-family, sans-serif);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			display: flex; align-items: center; justify-content: center;
			height: 100vh; margin: 0;
		}
		.loading { font-size: 1.1em; opacity: 0.7; }
	</style>
</head>
<body><div class="loading">Loading enterprise configuration...</div></body>
</html>`;
}

function getErrorHtml(nonce: string, message: string): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<style nonce="${nonce}">
		body {
			font-family: var(--vscode-font-family, sans-serif);
			color: var(--vscode-errorForeground);
			background: var(--vscode-editor-background);
			display: flex; align-items: center; justify-content: center;
			height: 100vh; margin: 0;
		}
	</style>
</head>
<body><div>${esc(message)}</div></body>
</html>`;
}

function getWebviewHtml(
	data: Record<string, unknown>,
	enterpriseId: string,
	focusCategory: EnterpriseConfigCategory | undefined,
	nonce: string,
): string {
	const dataJson = JSON.stringify(data).replace(/<\//g, '<\\/');
	const focusJson = focusCategory ? `"${focusCategory}"` : 'null';

	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<style nonce="${nonce}">
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family, sans-serif);
			font-size: 14px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}

		.header {
			position: sticky; top: 0; z-index: 10;
			padding: 16px 24px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.header h1 { font-size: 1.2em; font-weight: 600; }
		.header .subtitle {
			font-size: 0.85em; color: var(--vscode-descriptionForeground);
			margin-top: 4px;
		}

		.content { padding: 16px 24px 32px; }

		/* ── Accordion ── */
		.accordion { margin-bottom: 12px; }
		.accordion-header {
			display: flex; align-items: center; gap: 10px;
			padding: 12px 16px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			cursor: pointer;
			user-select: none;
			transition: background 0.15s;
		}
		.accordion-header:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.accordion.open .accordion-header {
			border-bottom-left-radius: 0;
			border-bottom-right-radius: 0;
		}
		.accordion-chevron {
			font-size: 0.8em;
			transition: transform 0.2s;
			opacity: 0.6;
		}
		.accordion.open .accordion-chevron {
			transform: rotate(90deg);
		}
		.accordion-title {
			font-weight: 600; font-size: 1em;
			flex: 1;
		}
		.accordion-count {
			font-size: 0.82em;
			color: var(--vscode-descriptionForeground);
		}
		.accordion-filter {
			display: none;
			position: relative;
		}
		.accordion.open .accordion-filter {
			display: block;
		}
		.accordion-filter input {
			background: var(--vscode-input-background, #1e1e1e);
			color: var(--vscode-input-foreground, #ccc);
			border: 1px solid var(--vscode-input-border, #3c3c3c);
			border-radius: 4px;
			padding: 4px 28px 4px 10px;
			font-size: 0.85em;
			width: 200px;
			outline: none;
		}
		.accordion-filter input:focus {
			border-color: var(--vscode-focusBorder, #007acc);
		}
		.accordion-filter input::placeholder {
			color: var(--vscode-input-placeholderForeground, #888);
		}
		.accordion-filter .filter-clear {
			position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
			background: none; border: none; color: var(--vscode-descriptionForeground);
			cursor: pointer; font-size: 1em; padding: 0 2px;
			display: none; line-height: 1;
		}
		.accordion-filter .filter-clear.visible { display: block; }
		.config-table tr.filter-hidden { display: none; }
		.filter-no-results {
			padding: 12px 14px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
			display: none;
		}
		.accordion-body {
			display: none;
			border: 1px solid var(--vscode-panel-border);
			border-top: none;
			border-bottom-left-radius: 6px;
			border-bottom-right-radius: 6px;
			overflow: hidden;
		}
		.accordion.open .accordion-body {
			display: block;
		}
		.accordion-empty {
			padding: 16px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
		}

		/* ── Config table ── */
		.config-table {
			width: 100%; border-collapse: collapse;
			font-size: 0.95em;
		}
		.config-table th {
			text-align: left; padding: 10px 14px;
			font-weight: 600; font-size: 0.85em;
			text-transform: uppercase; letter-spacing: 0.03em;
			color: var(--vscode-descriptionForeground);
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			white-space: nowrap;
		}
		.config-table td {
			padding: 9px 14px;
			border-bottom: 1px solid var(--vscode-panel-border);
			vertical-align: middle;
		}
		.config-table tr:last-child td { border-bottom: none; }
		.config-table tr:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.setting-key {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.95em;
			color: var(--vscode-textLink-foreground, #3794ff);
			white-space: nowrap;
		}
		.setting-value {
			word-break: break-word;
		}

		/* ── Value badges ── */
		.val-badge {
			display: inline-block; padding: 3px 10px; border-radius: 12px;
			font-size: 0.85em; font-weight: 600; white-space: nowrap;
		}
		.val-bool-true {
			background: #2ea04330; color: #3fb950;
		}
		.val-bool-false {
			background: #f8514930; color: #f85149;
		}
		.val-null {
			background: rgba(128,128,128,0.15); color: var(--vscode-descriptionForeground);
			font-style: italic;
		}
		.val-number {
			background: #56d4dd20; color: var(--vscode-terminal-ansiCyan, #56d4dd);
		}
		.val-string { color: var(--vscode-foreground); }

		/* ── Copy buttons ── */
		.copy-btn {
			background: none; border: 1px solid var(--vscode-panel-border);
			color: var(--vscode-descriptionForeground);
			border-radius: 4px; padding: 2px 7px;
			font-size: 0.78em; cursor: pointer;
			opacity: 0; transition: opacity 0.15s;
			vertical-align: middle; margin-left: 6px;
		}
		.copy-btn:hover {
			background: var(--vscode-list-hoverBackground);
			color: var(--vscode-foreground);
		}
		.copy-btn.copied {
			color: var(--vscode-terminal-ansiGreen, #3fb950);
			border-color: var(--vscode-terminal-ansiGreen, #3fb950);
		}
		tr:hover .copy-btn,
		.sub-header:hover .copy-btn,
		.accordion-header:hover .copy-cat-btn { opacity: 1; }
		.copy-cat-btn {
			background: none; border: 1px solid var(--vscode-panel-border);
			color: var(--vscode-descriptionForeground);
			border-radius: 4px; padding: 3px 10px;
			font-size: 0.78em; cursor: pointer;
			opacity: 0; transition: opacity 0.15s;
		}
		.copy-cat-btn:hover {
			background: var(--vscode-list-hoverBackground);
			color: var(--vscode-foreground);
		}
		.copy-cat-btn.copied {
			color: var(--vscode-terminal-ansiGreen, #3fb950);
			border-color: var(--vscode-terminal-ansiGreen, #3fb950);
		}

		/* ── Nested sub-section ── */
		.sub-header td {
			padding: 12px 14px 8px;
			font-weight: 600; font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
			background: rgba(128,128,128,0.06);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.indent-1 .setting-key { padding-left: 16px; }
		.indent-2 .setting-key { padding-left: 32px; }

		/* ── Array badge ── */
		.array-badge {
			display: inline-block; padding: 2px 8px; border-radius: 8px;
			font-size: 0.78em; font-weight: 600;
			background: rgba(128,128,128,0.15);
			color: var(--vscode-descriptionForeground);
			margin-left: 6px;
		}

		/* ── Shield not available ── */
		.shield-na {
			padding: 16px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>Enterprise Configuration</h1>
		<div class="subtitle">Enterprise ID: ${esc(enterpriseId)}</div>
	</div>

	<div class="content" id="content"></div>

	<script nonce="${nonce}">
	(function() {
		var DATA = ${dataJson};
		var FOCUS = ${focusJson};
		var CATEGORIES = [
			{ key: 'content_and_sharing', label: 'Content & Sharing' },
			{ key: 'security', label: 'Security' },
			{ key: 'shield', label: 'Shield' },
			{ key: 'user_settings', label: 'User Settings' }
		];

		var contentEl = document.getElementById('content');
		var COPY_DATA = {};
		var copyIdCounter = 0;
		var html = '';

		CATEGORIES.forEach(function(cat) {
			var catData = DATA[cat.key];
			var isOpen = FOCUS ? (FOCUS === cat.key) : true;
			var openClass = isOpen ? ' open' : '';

			html += '<div class="accordion' + openClass + '" data-cat="' + cat.key + '">';
			html += '<div class="accordion-header">';
			html += '<span class="accordion-chevron">&#9654;</span>';
			html += '<span class="accordion-title">' + esc(cat.label) + '</span>';

			if (catData && typeof catData === 'object') {
				var count = Object.keys(catData).length;
				html += '<span class="accordion-count">' + count + ' setting' + (count !== 1 ? 's' : '') + '</span>';
			}

			html += '<button class="copy-cat-btn" data-copy-cat="' + cat.key + '" title="Copy category JSON">Copy JSON</button>';

			html += '<div class="accordion-filter">';
			html += '<input type="text" class="filter-input" data-cat="' + cat.key + '" placeholder="Filter settings\u2026">';
			html += '<button class="filter-clear" data-cat="' + cat.key + '">&times;</button>';
			html += '</div>';

			html += '</div>';
			html += '<div class="accordion-body">';

			if (catData === null || catData === undefined) {
				html += '<div class="accordion-empty">Not available for this enterprise.</div>';
			} else if (typeof catData === 'object') {
				html += renderConfigTable(catData);
				html += '<div class="filter-no-results" data-cat="' + cat.key + '">No matching settings.</div>';
			} else {
				html += '<div class="accordion-empty">Unexpected data format.</div>';
			}

			html += '</div></div>';
		});

		contentEl.innerHTML = html;

		// ── Accordion toggle ──
		document.addEventListener('click', function(e) {
			// Don't toggle accordion when clicking filter input or clear button
			if (e.target.closest('.accordion-filter')) return;

			var header = e.target.closest('.accordion-header');
			if (!header) return;
			var accordion = header.closest('.accordion');
			if (accordion) accordion.classList.toggle('open');
		});

		// ── Filter typeahead ──
		document.addEventListener('input', function(e) {
			var input = e.target;
			if (!input.classList || !input.classList.contains('filter-input')) return;
			applyFilter(input);
		});

		document.addEventListener('click', function(e) {
			if (!e.target.classList || !e.target.classList.contains('filter-clear')) return;
			var catKey = e.target.getAttribute('data-cat');
			var input = document.querySelector('.filter-input[data-cat="' + catKey + '"]');
			if (input) {
				input.value = '';
				applyFilter(input);
				input.focus();
			}
		});

		function applyFilter(input) {
			var catKey = input.getAttribute('data-cat');
			var query = input.value.toLowerCase().trim();
			var accordion = input.closest('.accordion');
			if (!accordion) return;

			// Toggle clear button visibility
			var clearBtn = accordion.querySelector('.filter-clear[data-cat="' + catKey + '"]');
			if (clearBtn) {
				if (query) clearBtn.classList.add('visible');
				else clearBtn.classList.remove('visible');
			}

			var table = accordion.querySelector('.config-table');
			if (!table) return;

			var rows = table.querySelectorAll('tbody tr');
			var visibleCount = 0;

			rows.forEach(function(row) {
				if (row.classList.contains('sub-header')) {
					// Sub-headers: show if any child rows match
					row.classList.remove('filter-hidden');
					return;
				}
				var text = row.textContent.toLowerCase();
				if (!query || text.indexOf(query) !== -1) {
					row.classList.remove('filter-hidden');
					visibleCount++;
				} else {
					row.classList.add('filter-hidden');
				}
			});

			// Hide sub-headers that have no visible rows after them
			if (query) {
				var subHeaders = table.querySelectorAll('tbody tr.sub-header');
				subHeaders.forEach(function(sh) {
					var hasVisible = false;
					var next = sh.nextElementSibling;
					while (next && !next.classList.contains('sub-header')) {
						if (!next.classList.contains('filter-hidden')) hasVisible = true;
						next = next.nextElementSibling;
					}
					if (!hasVisible) sh.classList.add('filter-hidden');
				});
			}

			// Show/hide no-results message
			var noResults = accordion.querySelector('.filter-no-results[data-cat="' + catKey + '"]');
			if (noResults) {
				noResults.style.display = (query && visibleCount === 0) ? 'block' : 'none';
			}
		}

		// ── Copy handlers ──
		document.addEventListener('click', function(e) {
			// Copy category JSON
			var catBtn = e.target.closest('.copy-cat-btn');
			if (catBtn) {
				e.stopPropagation();
				var catKey = catBtn.getAttribute('data-copy-cat');
				var catData = DATA[catKey];
				copyToClipboard(JSON.stringify(catData, null, 2), catBtn);
				return;
			}

			// Copy setting / section JSON via COPY_DATA map
			var copyBtn = e.target.closest('.copy-btn');
			if (copyBtn) {
				var cid = copyBtn.getAttribute('data-copy-id');
				var text = COPY_DATA[cid];
				if (text) copyToClipboard(text, copyBtn);
				return;
			}
		});

		function copyToClipboard(text, btn) {
			navigator.clipboard.writeText(text).then(function() {
				var orig = btn.innerHTML;
				btn.classList.add('copied');
				btn.innerHTML = '&#10003;';
				btn.style.opacity = '1';
				setTimeout(function() {
					btn.classList.remove('copied');
					btn.innerHTML = orig;
					btn.style.opacity = '';
				}, 1500);
			});
		}

		// ── Render helpers ──
		function renderConfigTable(obj) {
			var rows = [];
			flattenObject(obj, '', 0, rows);

			if (rows.length === 0) {
				return '<div class="accordion-empty">No configuration settings.</div>';
			}

			var s = '<table class="config-table">';
			s += '<thead><tr><th>Setting</th><th>Value</th><th style="width:60px"></th></tr></thead>';
			s += '<tbody>';

			rows.forEach(function(row) {
				if (row.type === 'sub-header') {
					var cid = copyIdCounter++;
					try { COPY_DATA[cid] = JSON.stringify(row.rawData || {}, null, 2); } catch(e) { COPY_DATA[cid] = '{}'; }
					s += '<tr class="sub-header"><td colspan="2">' + esc(row.label) + '</td>';
					s += '<td><button class="copy-btn" data-copy-id="' + cid + '" title="Copy section JSON">&#128203;</button></td>';
					s += '</tr>';
				} else {
					var indentClass = row.indent > 0 ? ' indent-' + Math.min(row.indent, 2) : '';
					var rawKey = row.rawKey || row.key;
					var cid2 = copyIdCounter++;
					var obj = {}; obj[rawKey] = row.value;
					try { COPY_DATA[cid2] = JSON.stringify(obj, null, 2); } catch(e) { COPY_DATA[cid2] = '{}'; }
					s += '<tr class="' + indentClass + '">';
					s += '<td><span class="setting-key">' + esc(row.key) + '</span></td>';
					s += '<td class="setting-value">' + formatValue(row.value) + '</td>';
					s += '<td><button class="copy-btn" data-copy-id="' + cid2 + '" title="Copy setting JSON">&#128203;</button></td>';
					s += '</tr>';
				}
			});

			s += '</tbody></table>';
			return s;
		}

		function flattenObject(obj, prefix, indent, rows) {
			var keys = Object.keys(obj).sort(function(a, b) {
				// Put simple values first, objects/arrays last
				var aSimple = isSimpleValue(obj[a]);
				var bSimple = isSimpleValue(obj[b]);
				if (aSimple && !bSimple) return -1;
				if (!aSimple && bSimple) return 1;
				return a.localeCompare(b);
			});

			keys.forEach(function(key) {
				if (key === 'type' || key === 'id') return; // skip meta fields
				var val = obj[key];

				if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
					// Check if it's a wrapper that contains a 'value' key
					if ('value' in val) {
						var innerVal = val.value;
						// Render any sibling keys (e.g. is_used) as normal rows first
						var siblingKeys = Object.keys(val).filter(function(k) { return k !== 'value'; });
						if (innerVal !== null && typeof innerVal === 'object' && !Array.isArray(innerVal)) {
							rows.push({ type: 'sub-header', label: formatKeyLabel(key), rawData: val });
							siblingKeys.forEach(function(sk) {
								rows.push({ type: 'value', key: formatKeyLabel(sk), rawKey: sk, value: val[sk], indent: indent + 1 });
							});
							flattenObject(innerVal, key + '.', indent + 1, rows);
						} else if (Array.isArray(innerVal)) {
							siblingKeys.forEach(function(sk) {
								rows.push({ type: 'value', key: formatKeyLabel(key + ' ' + sk), rawKey: key + '.' + sk, value: val[sk], indent: indent });
							});
							renderArrayRows(key, innerVal, indent, rows);
						} else {
							rows.push({ type: 'value', key: formatKeyLabel(key), rawKey: key, value: innerVal, indent: indent });
						}
					} else {
						rows.push({ type: 'sub-header', label: formatKeyLabel(key), rawData: val });
						flattenObject(val, key + '.', indent + 1, rows);
					}
				} else if (Array.isArray(val)) {
					renderArrayRows(key, val, indent, rows);
				} else {
					rows.push({ type: 'value', key: formatKeyLabel(key), rawKey: key, value: val, indent: indent });
				}
			});
		}

		function renderArrayRows(key, arr, indent, rows) {
			if (arr.length === 0) {
				rows.push({ type: 'value', key: formatKeyLabel(key), value: '(empty)', indent: indent });
				return;
			}

			// If array of primitives, join them
			if (arr.every(function(v) { return isSimpleValue(v); })) {
				rows.push({ type: 'value', key: formatKeyLabel(key), value: arr.join(', '), indent: indent });
				return;
			}

			// Array of objects — render as sub-section
			rows.push({ type: 'sub-header', label: formatKeyLabel(key) + ' (' + arr.length + ' items)' });
			arr.forEach(function(item, i) {
				if (typeof item === 'object' && item !== null) {
					// For each array item, flatten its properties
					var itemKeys = Object.keys(item);
					itemKeys.forEach(function(ik) {
						var label = arr.length > 1
							? formatKeyLabel(ik) + ' [' + (i + 1) + ']'
							: formatKeyLabel(ik);
						if (isSimpleValue(item[ik])) {
							rows.push({ type: 'value', key: label, value: item[ik], indent: indent + 1 });
						} else if (item[ik] !== null && typeof item[ik] === 'object') {
							rows.push({ type: 'sub-header', label: label });
							if (Array.isArray(item[ik])) {
								renderArrayRows(ik, item[ik], indent + 2, rows);
							} else {
								flattenObject(item[ik], '', indent + 2, rows);
							}
						}
					});
				} else {
					rows.push({ type: 'value', key: '[' + i + ']', value: item, indent: indent + 1 });
				}
			});
		}

		function isSimpleValue(v) {
			return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
		}

		function formatKeyLabel(key) {
			return key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
		}

		function formatValue(val) {
			if (val === null || val === undefined) return '<span class="val-badge val-null">null</span>';
			if (val === true) return '<span class="val-badge val-bool-true">true</span>';
			if (val === false) return '<span class="val-badge val-bool-false">false</span>';
			if (typeof val === 'number') return '<span class="val-badge val-number">' + val + '</span>';
			if (typeof val === 'string') {
				if (val === '(empty)') return '<span class="val-badge val-null">(empty)</span>';
				// Check if it looks like a date
				if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
					try {
						var d = new Date(val);
						return '<span class="val-string">' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
							+ ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '</span>';
					} catch(e) { /* fall through */ }
				}
				return '<span class="val-string">' + esc(val) + '</span>';
			}
			return '<span class="val-string">' + esc(String(val)) + '</span>';
		}

		function esc(s) {
			return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
		}
	})();
	</script>
</body>
</html>`;
}

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
