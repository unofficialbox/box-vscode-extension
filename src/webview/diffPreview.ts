import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BoxClientResult } from '../utils/boxClient';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { deployTemplate, deployTaxonomy, TemplateJson, TaxonomyJson } from '../commands/deploy/deployMetadata';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiffItem {
	fileName: string;
	localJson: unknown;
	remoteJson: unknown | null;
	type: 'template' | 'taxonomy';
}

// ─── Panel state ────────────────────────────────────────────────────────────

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;

// ─── Public API ─────────────────────────────────────────────────────────────

export function openDiffPreview(
	items: DiffItem[],
	clientResult: BoxClientResult,
	alias: string,
	enterpriseId: string,
): void {
	const title = `Diff — ${alias}`;

	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.One);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'boxDiffPreview',
			title,
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		currentPanel.onDidDispose(() => {
			currentPanel = undefined;
			messageListener?.dispose();
			messageListener = undefined;
		});
	}

	messageListener?.dispose();
	messageListener = currentPanel.webview.onDidReceiveMessage(async (msg) => {
		if (msg.type === 'cancel') {
			currentPanel?.dispose();
		} else if (msg.type === 'deploy') {
			await handleDeploy(items, clientResult, alias, enterpriseId);
		}
	});

	const nonce = crypto.randomBytes(16).toString('hex');
	currentPanel.webview.html = getWebviewHtml(items, alias, nonce);
}

// ─── Deploy handler ─────────────────────────────────────────────────────────

async function handleDeploy(
	items: DiffItem[],
	clientResult: BoxClientResult,
	alias: string,
	enterpriseId: string,
): Promise<void> {
	currentPanel?.webview.postMessage({ type: 'status', text: 'Deploying...', level: 'info' });

	let successCount = 0;
	let failCount = 0;

	for (const item of items) {
		try {
			if (item.type === 'template') {
				await deployTemplate(clientResult.client, item.localJson as TemplateJson);
			} else {
				await deployTaxonomy(clientResult.client, item.localJson as TaxonomyJson, enterpriseId);
			}
			successCount++;
			log(ext.out, `[DiffDeploy] Deployed "${item.fileName}" to ${alias}.`);
		} catch (err) {
			failCount++;
			const message = err instanceof Error ? err.message : String(err);
			log(ext.out, `[DiffDeploy] Failed to deploy "${item.fileName}": ${message}`);
		}
	}

	const summary = `Deploy complete: ${successCount} succeeded, ${failCount} failed.`;
	log(ext.out, `[DiffDeploy] ${summary}`);

	if (failCount > 0) {
		currentPanel?.webview.postMessage({ type: 'status', text: summary, level: 'error' });
		vscode.window.showWarningMessage(summary);
	} else {
		vscode.window.showInformationMessage(summary);
		currentPanel?.dispose();
	}

	vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
}

// ─── HTML generation ────────────────────────────────────────────────────────

function getWebviewHtml(items: DiffItem[], alias: string, nonce: string): string {
	const dataJson = JSON.stringify(items.map(item => ({
		fileName: item.fileName,
		localStr: JSON.stringify(item.localJson, null, 2),
		remoteStr: item.remoteJson !== null ? JSON.stringify(item.remoteJson, null, 2) : null,
		type: item.type,
	}))).replace(/<\//g, '<\\/');

	const aliasEsc = esc(alias);

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
			font-size: var(--vscode-font-size, 13px);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}

		.toolbar {
			position: sticky; top: 0; z-index: 10;
			display: flex; align-items: center; gap: 12px;
			padding: 12px 20px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.toolbar h1 { font-size: 1.1em; font-weight: 600; flex: 1; }
		.toolbar .summary {
			font-size: 0.85em; font-weight: 400;
			color: var(--vscode-descriptionForeground);
			margin-left: 12px;
		}
		.cancel-btn {
			background: var(--vscode-errorForeground, #f44);
			color: #fff;
			border: none; border-radius: 3px; padding: 6px 16px;
			font-size: 0.9em; cursor: pointer; font-weight: 600;
		}
		.cancel-btn:hover { opacity: 0.85; }
		.deploy-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none; border-radius: 3px; padding: 6px 16px;
			font-size: 0.9em; cursor: pointer; font-weight: 600;
		}
		.deploy-btn:hover { background: var(--vscode-button-hoverBackground); }
		.deploy-btn:disabled, .cancel-btn:disabled {
			opacity: 0.5; cursor: default;
		}

		.status-msg {
			margin: 0; padding: 8px 20px;
			font-size: 0.9em; display: none;
		}
		.status-msg.error {
			display: block;
			background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
			border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
		}
		.status-msg.info {
			display: block;
			background: var(--vscode-inputValidation-infoBackground, #063b49);
			border-bottom: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
		}
		.status-msg.success {
			display: block;
			background: var(--vscode-terminal-ansiGreen, #1b5e20);
			color: #fff;
			border-bottom: 1px solid rgba(255,255,255,0.2);
		}

		.content { padding: 0 20px 20px; }

		.diff-file { margin-top: 16px; }
		.diff-file-header {
			display: flex; align-items: center; gap: 8px;
			padding: 8px 12px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border: 1px solid var(--vscode-panel-border);
			border-bottom: none;
			border-radius: 4px 4px 0 0;
			cursor: pointer;
			user-select: none;
		}
		.diff-file-header:hover { background: var(--vscode-list-hoverBackground); }
		.diff-file-name {
			font-family: var(--vscode-editor-font-family, monospace);
			font-weight: 600; font-size: 0.95em;
		}
		.diff-chevron { font-size: 0.8em; opacity: 0.7; }

		.badge {
			display: inline-block; padding: 1px 8px; border-radius: 10px;
			font-size: 0.78em; font-weight: 600; text-transform: uppercase;
		}
		.badge-new { background: #2ea04370; color: #3fb950; }
		.badge-modified { background: #d2992240; color: #d29922; }
		.badge-unchanged { background: rgba(128,128,128,0.2); color: var(--vscode-descriptionForeground); }

		.diff-block {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 0 0 4px 4px;
			overflow: hidden;
		}
		.diff-block.collapsed { display: none; }

		.diff-table {
			width: 100%; border-collapse: collapse;
			font-family: var(--vscode-editor-font-family, 'SF Mono', SFMono-Regular, Consolas, monospace);
			font-size: 0.82rem; line-height: 1.55;
			table-layout: fixed;
		}
		.diff-table td { padding: 0 8px; white-space: pre; overflow: hidden; text-overflow: ellipsis; }

		.line-gutter {
			width: 20px; min-width: 20px; max-width: 20px;
			text-align: center;
			color: var(--vscode-editorLineNumber-foreground, rgba(128,128,128,0.6));
			user-select: none;
		}
		.line-num {
			width: 40px; min-width: 40px; max-width: 40px;
			text-align: right; padding-right: 8px !important;
			color: var(--vscode-editorLineNumber-foreground, rgba(128,128,128,0.6));
			user-select: none;
		}
		.line-content { width: 100%; }

		tr.diff-added { background: var(--vscode-diffEditor-insertedLineBackground, rgba(35,134,54,0.2)); }
		tr.diff-added .line-gutter { color: #3fb950; }
		tr.diff-removed { background: var(--vscode-diffEditor-removedLineBackground, rgba(248,81,73,0.2)); }
		tr.diff-removed .line-gutter { color: #f85149; }
		tr.diff-context { background: transparent; }

		.diff-separator {
			padding: 4px 12px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			color: var(--vscode-descriptionForeground);
			font-size: 0.82rem;
			font-style: italic;
			border-top: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.no-changes {
			padding: 12px 16px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<h1>Diff and Deploy to ${aliasEsc}
			<span class="summary" id="summary"></span>
		</h1>
		<button class="cancel-btn" id="cancel-btn">Cancel</button>
		<button class="deploy-btn" id="deploy-btn">Deploy</button>
	</div>

	<div id="status-msg" class="status-msg"></div>
	<div class="content" id="content"></div>

	<script nonce="${nonce}">
	(function() {
		var vscode = acquireVsCodeApi();
		var ITEMS = ${dataJson};
		var contentEl = document.getElementById('content');
		var summaryEl = document.getElementById('summary');
		var statusEl = document.getElementById('status-msg');
		var deployBtn = document.getElementById('deploy-btn');
		var deployed = false;

		// ── Summary ──
		var newCount = 0, modCount = 0, unchangedCount = 0;
		ITEMS.forEach(function(item) {
			if (item.remoteStr === null) { newCount++; }
			else if (item.remoteStr === item.localStr) { unchangedCount++; }
			else { modCount++; }
		});
		var parts = [];
		parts.push(ITEMS.length + ' file' + (ITEMS.length !== 1 ? 's' : ''));
		if (newCount) parts.push(newCount + ' new');
		if (modCount) parts.push(modCount + ' modified');
		if (unchangedCount) parts.push(unchangedCount + ' unchanged');
		summaryEl.textContent = '(' + parts.join(', ') + ')';

		// ── Render ──
		var html = '';
		ITEMS.forEach(function(item, idx) {
			var isNew = item.remoteStr === null;
			var isUnchanged = !isNew && item.remoteStr === item.localStr;
			var badgeClass = isNew ? 'badge-new' : (isUnchanged ? 'badge-unchanged' : 'badge-modified');
			var badgeLabel = isNew ? 'New' : (isUnchanged ? 'Unchanged' : 'Modified');
			var collapsed = isUnchanged ? ' collapsed' : '';

			html += '<div class="diff-file">';
			html += '<div class="diff-file-header" data-toggle="' + idx + '">';
			html += '<span class="diff-chevron" id="chev-' + idx + '">' + (isUnchanged ? '&#x25B6;' : '&#x25BC;') + '</span>';
			html += '<span class="diff-file-name">' + esc(item.fileName) + '</span>';
			html += '<span class="badge ' + badgeClass + '">' + badgeLabel + '</span>';
			html += '</div>';

			html += '<div class="diff-block' + collapsed + '" id="block-' + idx + '">';
			if (isUnchanged) {
				html += '<div class="no-changes">No changes detected.</div>';
			} else if (isNew) {
				html += renderAddedDiff(item.localStr);
			} else {
				html += renderUnifiedDiff(item.remoteStr, item.localStr);
			}
			html += '</div></div>';
		});
		contentEl.innerHTML = html;

		// ── Toggle collapse ──
		document.addEventListener('click', function(e) {
			var header = e.target.closest('[data-toggle]');
			if (header) {
				var idx = header.getAttribute('data-toggle');
				var block = document.getElementById('block-' + idx);
				var chev = document.getElementById('chev-' + idx);
				if (block.classList.contains('collapsed')) {
					block.classList.remove('collapsed');
					chev.innerHTML = '&#x25BC;';
				} else {
					block.classList.add('collapsed');
					chev.innerHTML = '&#x25B6;';
				}
				return;
			}

			if (e.target.closest('#cancel-btn')) {
				vscode.postMessage({ type: 'cancel' });
				return;
			}
			if (e.target.closest('#deploy-btn') && !deployed) {
				deployed = true;
				deployBtn.disabled = true;
				vscode.postMessage({ type: 'deploy' });
				return;
			}
		});

		// ── Messages from extension ──
		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'status') {
				statusEl.textContent = msg.text;
				statusEl.className = 'status-msg ' + msg.level;
				if (msg.level === 'success' || msg.level === 'error') {
					deployBtn.textContent = 'Done';
				}
			}
		});

		// ── Diff rendering helpers ──

		function renderAddedDiff(str) {
			var lines = str.split('\\n');
			var rows = '';
			for (var i = 0; i < lines.length; i++) {
				rows += '<tr class="diff-added">' +
					'<td class="line-gutter">+</td>' +
					'<td class="line-num">' + (i + 1) + '</td>' +
					'<td class="line-content">' + esc(lines[i]) + '</td></tr>';
			}
			return '<table class="diff-table">' + rows + '</table>';
		}

		function renderUnifiedDiff(oldStr, newStr) {
			var oldLines = oldStr.split('\\n');
			var newLines = newStr.split('\\n');
			var ops = lcs(oldLines, newLines);

			// Build hunks with context
			var CONTEXT = 3;
			var allOps = ops;
			var hunks = buildHunks(allOps, CONTEXT);
			if (hunks.length === 0) {
				return '<div class="no-changes">No changes detected.</div>';
			}

			var html = '<table class="diff-table">';
			for (var h = 0; h < hunks.length; h++) {
				if (h > 0) {
					html += '<tr><td colspan="3" class="diff-separator">...</td></tr>';
				}
				var hunk = hunks[h];
				for (var i = 0; i < hunk.length; i++) {
					var op = hunk[i];
					if (op.type === 'equal') {
						html += '<tr class="diff-context">' +
							'<td class="line-gutter"> </td>' +
							'<td class="line-num">' + op.newNum + '</td>' +
							'<td class="line-content">' + esc(op.line) + '</td></tr>';
					} else if (op.type === 'remove') {
						html += '<tr class="diff-removed">' +
							'<td class="line-gutter">-</td>' +
							'<td class="line-num">' + op.oldNum + '</td>' +
							'<td class="line-content">' + esc(op.line) + '</td></tr>';
					} else {
						html += '<tr class="diff-added">' +
							'<td class="line-gutter">+</td>' +
							'<td class="line-num">' + op.newNum + '</td>' +
							'<td class="line-content">' + esc(op.line) + '</td></tr>';
					}
				}
			}
			html += '</table>';
			return html;
		}

		// ── LCS diff ──
		function lcs(oldLines, newLines) {
			var m = oldLines.length;
			var n = newLines.length;

			// Build LCS table
			var dp = [];
			for (var i = 0; i <= m; i++) {
				dp[i] = [];
				for (var j = 0; j <= n; j++) {
					if (i === 0 || j === 0) { dp[i][j] = 0; }
					else if (oldLines[i - 1] === newLines[j - 1]) { dp[i][j] = dp[i - 1][j - 1] + 1; }
					else { dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); }
				}
			}

			// Backtrack to produce operations
			var ops = [];
			var i = m, j = n;
			while (i > 0 || j > 0) {
				if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
					ops.push({ type: 'equal', line: newLines[j - 1], oldNum: i, newNum: j });
					i--; j--;
				} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
					ops.push({ type: 'add', line: newLines[j - 1], newNum: j });
					j--;
				} else {
					ops.push({ type: 'remove', line: oldLines[i - 1], oldNum: i });
					i--;
				}
			}
			ops.reverse();
			return ops;
		}

		function buildHunks(ops, context) {
			// Find ranges of changes and include context lines around them
			var changeIndices = [];
			for (var i = 0; i < ops.length; i++) {
				if (ops[i].type !== 'equal') changeIndices.push(i);
			}
			if (changeIndices.length === 0) return [];

			var hunks = [];
			var hunkStart = Math.max(0, changeIndices[0] - context);
			var hunkEnd = Math.min(ops.length - 1, changeIndices[0] + context);

			for (var c = 1; c < changeIndices.length; c++) {
				var nextStart = Math.max(0, changeIndices[c] - context);
				var nextEnd = Math.min(ops.length - 1, changeIndices[c] + context);
				if (nextStart <= hunkEnd + 1) {
					// Merge with current hunk
					hunkEnd = nextEnd;
				} else {
					// Emit current hunk, start new one
					hunks.push(ops.slice(hunkStart, hunkEnd + 1));
					hunkStart = nextStart;
					hunkEnd = nextEnd;
				}
			}
			hunks.push(ops.slice(hunkStart, hunkEnd + 1));
			return hunks;
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
