import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BoxClientResult } from '../utils/boxClient';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { executeUpload } from '../commands/files/uploadItems';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UploadDiffItem {
	displayPath: string;
	localUri: vscode.Uri;
	status: 'new' | 'modified' | 'unchanged' | 'duplicate';
	type: 'file' | 'folder';
	parentFolderId: string;
	remoteFileId?: string;
	localSha1?: string;
	remoteSha1?: string;
	/** When status is 'duplicate', the names of remote files with the same content. */
	remoteMatchNames?: string[];
	/** Remote file metadata. */
	remoteSize?: number;
	remoteCreatedBy?: string;
	remoteCreatedAt?: string;
}

// ─── Panel state ────────────────────────────────────────────────────────────

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;

// ─── Public API ─────────────────────────────────────────────────────────────

export function openUploadDiffPreview(
	items: UploadDiffItem[],
	clientResult: BoxClientResult,
	alias: string,
): void {
	const title = `Upload — ${alias}`;

	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.One);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'boxUploadDiffPreview',
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
			const excluded = new Set<number>(msg.excluded ?? []);
			const selected = items.filter((_, i) => !excluded.has(i));
			await handleUpload(selected, clientResult, alias);
		}
	});

	const nonce = crypto.randomBytes(16).toString('hex');
	currentPanel.webview.html = getWebviewHtml(items, alias, nonce);
}

// ─── Upload handler ─────────────────────────────────────────────────────────

async function handleUpload(
	items: UploadDiffItem[],
	clientResult: BoxClientResult,
	alias: string,
): Promise<void> {
	currentPanel?.webview.postMessage({ type: 'status', text: 'Uploading...', level: 'info' });

	const { successCount, failCount } = await executeUpload(items, clientResult);

	const summary = `Upload complete: ${successCount} succeeded, ${failCount} failed.`;
	log(ext.out, `[Upload] ${summary}`);

	if (failCount > 0) {
		currentPanel?.webview.postMessage({ type: 'status', text: summary, level: 'error' });
		vscode.window.showWarningMessage(summary);
	} else {
		vscode.window.showInformationMessage(summary);
		currentPanel?.dispose();
	}

	vscode.commands.executeCommand('box-vscode-extension.refreshAllFiles');
}

// ─── HTML generation ────────────────────────────────────────────────────────

function getWebviewHtml(items: UploadDiffItem[], alias: string, nonce: string): string {
	const newCount = items.filter(i => i.status === 'new').length;
	const modCount = items.filter(i => i.status === 'modified').length;
	const dupCount = items.filter(i => i.status === 'duplicate').length;
	const unchangedCount = items.filter(i => i.status === 'unchanged').length;

	const dataJson = JSON.stringify(items.map((item, idx) => ({
		idx,
		displayPath: item.displayPath,
		status: item.status,
		type: item.type,
		localSha1: item.localSha1 ?? null,
		remoteSha1: item.remoteSha1 ?? null,
		remoteMatchNames: item.remoteMatchNames ?? [],
		remoteSize: item.remoteSize ?? null,
		remoteCreatedBy: item.remoteCreatedBy ?? null,
		remoteCreatedAt: item.remoteCreatedAt ?? null,
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

		.content { padding: 12px 20px 20px; }

		.section-header {
			display: flex; align-items: center; gap: 8px;
			font-weight: 600; font-size: 0.95em;
			padding: 14px 0 6px;
			color: var(--vscode-descriptionForeground);
		}
		.section-toggle { cursor: pointer; }

		.diff-table {
			width: 100%; border-collapse: collapse;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.88em;
			table-layout: fixed;
		}
		.diff-table col.col-check  { width: 36px; }
		.diff-table col.col-file   { width: 220px; }
		.diff-table col.col-local  { width: 170px; }
		.diff-table col.col-remote { width: 170px; }
		.diff-table col.col-size   { width: 80px; }
		.diff-table col.col-author { width: 130px; }
		.diff-table col.col-date   { width: 150px; }
		.diff-table col.col-status { width: 100px; }
		.diff-table th {
			text-align: left; padding: 6px 10px;
			font-weight: 600; font-size: 0.82em;
			text-transform: uppercase; letter-spacing: 0.03em;
			color: var(--vscode-descriptionForeground);
			border-bottom: 2px solid var(--vscode-panel-border);
			white-space: nowrap;
			position: relative;
			user-select: none;
		}
		.diff-table th:first-child { text-align: center; }
		.resize-handle {
			position: absolute; right: -1px; top: 4px; bottom: 4px;
			width: 3px; cursor: col-resize;
			border-radius: 2px;
			background: var(--vscode-panel-border, rgba(128,128,128,0.3));
			transition: background 0.15s, width 0.15s;
		}
		.resize-handle:hover, .resize-handle.active {
			width: 4px;
			background: var(--vscode-focusBorder, #007acc);
		}
		.diff-table td {
			padding: 7px 10px;
			border-bottom: 1px solid var(--vscode-panel-border);
			vertical-align: top;
			overflow: hidden; text-overflow: ellipsis;
		}
		.diff-table td:first-child { text-align: center; }
		.diff-table tr.excluded { opacity: 0.4; }
		.diff-table tr.section-row td {
			border-bottom: none; padding: 0;
		}

		.file-name { white-space: nowrap; }
		.file-icon { opacity: 0.7; margin-right: 6px; }
		.duplicate-hint {
			display: block; font-size: 0.85em; margin-top: 3px;
			color: #f85149;
		}

		.sha-cell {
			font-size: 0.82em;
			color: var(--vscode-descriptionForeground);
			word-break: break-all;
		}
		.sha-match { color: var(--vscode-terminal-ansiGreen, #3fb950); }
		.sha-mismatch { color: var(--vscode-terminal-ansiYellow, #d29922); }
		.sha-na { opacity: 0.4; font-style: italic; }
		.meta-cell {
			font-size: 0.85em;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}
		.meta-na { opacity: 0.4; font-style: italic; }

		.badge {
			display: inline-block; padding: 3px 12px; border-radius: 12px;
			font-size: 0.82em; font-weight: 600; text-transform: uppercase;
			letter-spacing: 0.03em; white-space: nowrap;
		}
		.badge-new { background: #2ea04370; color: #3fb950; }
		.badge-modified { background: #d2992240; color: #d29922; }
		.badge-duplicate { background: #f8514940; color: #f85149; }
		.badge-unchanged { background: rgba(128,128,128,0.2); color: var(--vscode-descriptionForeground); }
	</style>
</head>
<body>
	<div class="toolbar">
		<h1>Upload folders/ to ${aliasEsc}
			<span class="summary" id="summary"></span>
		</h1>
		<button class="cancel-btn" id="cancel-btn">Cancel</button>
		<button class="deploy-btn" id="deploy-btn">Upload</button>
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
		var newCount = 0, modCount = 0, dupCount = 0, unchangedCount = 0;
		ITEMS.forEach(function(item) {
			if (item.status === 'new') newCount++;
			else if (item.status === 'modified') modCount++;
			else if (item.status === 'duplicate') dupCount++;
			else unchangedCount++;
		});

		var parts = [];
		parts.push(ITEMS.length + ' item' + (ITEMS.length !== 1 ? 's' : ''));
		if (newCount) parts.push(newCount + ' new');
		if (modCount) parts.push(modCount + ' modified');
		if (dupCount) parts.push(dupCount + ' duplicate');
		if (unchangedCount) parts.push(unchangedCount + ' unchanged');
		summaryEl.textContent = '(' + parts.join(', ') + ')';

		// ── Render ──
		var html = '';

		function renderRow(item, badgeClass, badgeLabel) {
			var icon = item.type === 'folder' ? '&#128193;' : '&#128196;';
			var included = item.status !== 'unchanged';
			var checked = included ? ' checked' : '';
			var excludedClass = included ? '' : ' excluded';

			var localSha = item.localSha1
				? esc(item.localSha1)
				: '<span class="sha-na">' + (item.type === 'folder' ? '—' : 'n/a') + '</span>';

			var remoteSha = '';
			if (item.remoteSha1) {
				var match = item.localSha1 && item.localSha1 === item.remoteSha1;
				remoteSha = '<span class="' + (match ? 'sha-match' : 'sha-mismatch') + '">'
					+ esc(item.remoteSha1) + '</span>';
			} else {
				remoteSha = '<span class="sha-na">'
					+ (item.type === 'folder' ? '—' : (item.status === 'new' ? 'new file' : 'n/a'))
					+ '</span>';
			}

			var nameHtml = '<span class="file-icon">' + icon + '</span>'
				+ '<span class="file-name">' + esc(item.displayPath) + '</span>';
			if (item.status === 'duplicate' && item.remoteMatchNames && item.remoteMatchNames.length > 0) {
				var count = item.remoteMatchNames.length;
				var label = count === 1
					? 'Identical content exists remotely as:'
					: 'Identical content exists in ' + count + ' remote files:';
				nameHtml += '<span class="duplicate-hint">' + label;
				item.remoteMatchNames.forEach(function(name) {
					nameHtml += '<br>&nbsp;&nbsp;&bull; <strong>' + esc(name) + '</strong>';
				});
				nameHtml += '</span>';
			}

			var sizeHtml = item.remoteSize != null
				? '<span class="meta-cell">' + formatSize(item.remoteSize) + '</span>'
				: '<span class="meta-na">—</span>';

			var authorHtml = item.remoteCreatedBy
				? '<span class="meta-cell">' + esc(item.remoteCreatedBy) + '</span>'
				: '<span class="meta-na">—</span>';

			var dateHtml = item.remoteCreatedAt
				? '<span class="meta-cell">' + formatDate(item.remoteCreatedAt) + '</span>'
				: '<span class="meta-na">—</span>';

			return '<tr class="' + excludedClass + '" data-idx="' + item.idx + '">'
				+ '<td><input type="checkbox" class="file-check" data-idx="' + item.idx + '"' + checked + '></td>'
				+ '<td>' + nameHtml + '</td>'
				+ '<td class="sha-cell">' + localSha + '</td>'
				+ '<td class="sha-cell">' + remoteSha + '</td>'
				+ '<td>' + sizeHtml + '</td>'
				+ '<td>' + authorHtml + '</td>'
				+ '<td>' + dateHtml + '</td>'
				+ '<td><span class="badge ' + badgeClass + '">' + badgeLabel + '</span></td>'
				+ '</tr>';
		}

		function formatSize(bytes) {
			if (bytes < 1024) return bytes + ' B';
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
			if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
			return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
		}

		function formatDate(iso) {
			try {
				var d = new Date(iso);
				return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
					+ ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
			} catch(e) { return iso; }
		}

		function renderSectionRows(label, items, badgeClass) {
			if (items.length === 0) return '';
			var sectionChecked = (label !== 'Unchanged') ? ' checked' : '';
			var s = '<tr class="section-row"><td colspan="8">';
			s += '<div class="section-header">';
			s += '<input type="checkbox" class="section-toggle" data-section="' + label + '"'
				+ sectionChecked + '>';
			s += label + ' (' + items.length + ')';
			s += '</div></td></tr>';
			items.forEach(function(item) {
				s += renderRow(item, badgeClass, label);
			});
			return s;
		}

		var newItems = ITEMS.filter(function(i) { return i.status === 'new'; });
		var modItems = ITEMS.filter(function(i) { return i.status === 'modified'; });
		var dupItems = ITEMS.filter(function(i) { return i.status === 'duplicate'; });
		var unchangedItems = ITEMS.filter(function(i) { return i.status === 'unchanged'; });

		var colgroup = '<colgroup>'
			+ '<col class="col-check">'
			+ '<col class="col-file">'
			+ '<col class="col-local">'
			+ '<col class="col-remote">'
			+ '<col class="col-size">'
			+ '<col class="col-author">'
			+ '<col class="col-date">'
			+ '<col class="col-status">'
			+ '</colgroup>';

		html += '<table class="diff-table">';
		html += colgroup;
		html += '<thead><tr>'
			+ '<th></th>'
			+ '<th>File</th>'
			+ '<th>Local SHA-1</th>'
			+ '<th>Remote SHA-1</th>'
			+ '<th>Size</th>'
			+ '<th>Created By</th>'
			+ '<th>Created</th>'
			+ '<th>Status</th>'
			+ '</tr></thead><tbody>';
		html += renderSectionRows('New', newItems, 'badge-new');
		html += renderSectionRows('Modified', modItems, 'badge-modified');
		html += renderSectionRows('Duplicate', dupItems, 'badge-duplicate');
		html += renderSectionRows('Unchanged', unchangedItems, 'badge-unchanged');
		html += '</tbody></table>';

		contentEl.innerHTML = html;

		// ── Events ──
		document.addEventListener('change', function(e) {
			var cb = e.target;
			if (cb.classList.contains('section-toggle')) {
				// Find all rows between this section header and the next
				var headerRow = cb.closest('tr.section-row');
				if (!headerRow) return;
				var sibling = headerRow.nextElementSibling;
				while (sibling && !sibling.classList.contains('section-row')) {
					var check = sibling.querySelector('.file-check');
					if (check) {
						check.checked = cb.checked;
						updateRowStyle(check);
					}
					sibling = sibling.nextElementSibling;
				}
				return;
			}
			if (cb.classList.contains('file-check')) {
				updateRowStyle(cb);
			}
		});

		function updateRowStyle(cb) {
			var tr = cb.closest('tr');
			if (tr) {
				if (cb.checked) { tr.classList.remove('excluded'); }
				else { tr.classList.add('excluded'); }
			}
		}

		document.addEventListener('click', function(e) {
			if (e.target.closest('#cancel-btn')) {
				vscode.postMessage({ type: 'cancel' });
				return;
			}
			if (e.target.closest('#deploy-btn') && !deployed) {
				deployed = true;
				deployBtn.disabled = true;
				var excluded = [];
				document.querySelectorAll('.file-check').forEach(function(cb) {
					if (!cb.checked) excluded.push(parseInt(cb.getAttribute('data-idx'), 10));
				});
				vscode.postMessage({ type: 'deploy', excluded: excluded });
				return;
			}
		});

		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'status') {
				statusEl.textContent = msg.text;
				statusEl.className = 'status-msg ' + msg.level;
				if (msg.level === 'error') {
					deployBtn.textContent = 'Done';
				}
			}
		});

		function esc(s) {
			return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
		}

		// ── Column resize ──
		(function initResize() {
			var table = document.querySelector('.diff-table');
			if (!table) return;
			var ths = table.querySelectorAll('thead th');
			ths.forEach(function(th, idx) {
				if (idx === 0) return; // skip checkbox column
				var handle = document.createElement('div');
				handle.className = 'resize-handle';
				th.appendChild(handle);

				var startX, startW;
				handle.addEventListener('mousedown', function(e) {
					e.preventDefault();
					startX = e.pageX;
					startW = th.offsetWidth;
					handle.classList.add('active');
					var cols = table.querySelectorAll('colgroup col');
					function onMove(ev) {
						var delta = ev.pageX - startX;
						var newW = Math.max(30, startW + delta);
						th.style.width = newW + 'px';
						if (cols[idx]) cols[idx].style.width = newW + 'px';
					}
					function onUp() {
						handle.classList.remove('active');
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
					}
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
			});
		})();
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
