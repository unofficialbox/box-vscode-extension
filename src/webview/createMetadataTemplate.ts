import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { CreateMetadataTemplateRequestBody, CreateMetadataTemplateRequestBodyFieldsTypeField } from 'box-node-sdk/lib/managers/metadataTemplates';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;

// ─── Public API ──────────────────────────────────────────────────────────────

export function openCreateMetadataTemplate(): void {
	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	currentPanel = vscode.window.createWebviewPanel(
		'boxCreateMetadataTemplate',
		'Create Metadata Template',
		vscode.ViewColumn.One,
		{ enableScripts: true },
	);

	currentPanel.onDidDispose(() => {
		currentPanel = undefined;
		messageListener?.dispose();
		messageListener = undefined;
	});

	messageListener?.dispose();
	messageListener = currentPanel.webview.onDidReceiveMessage(async (msg) => {
		if (msg.type === 'create') {
			await handleCreate(msg);
		} else if (msg.type === 'copy') {
			await vscode.env.clipboard.writeText(msg.text);
			vscode.window.showInformationMessage(`Copied: ${msg.text}`);
		}
	});

	const nonce = crypto.randomBytes(16).toString('hex');
	currentPanel.webview.html = getWebviewHtml(nonce);
}

// ─── Create template via API ────────────────────────────────────────────────

interface CreateFieldData {
	type: string;
	key: string;
	displayName: string;
	description: string;
	options: string[];
}

async function handleCreate(msg: {
	displayName: string;
	templateKey: string;
	hidden: boolean;
	copyInstanceOnItemCopy: boolean;
	fields: CreateFieldData[];
}): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available.');
		return;
	}

	const fields = msg.fields.map(f => {
		const field: { type: CreateMetadataTemplateRequestBodyFieldsTypeField; key: string; displayName: string; description?: string; options?: { key: string }[] } = {
			type: f.type as CreateMetadataTemplateRequestBodyFieldsTypeField,
			key: f.key,
			displayName: f.displayName,
		};
		if (f.description) { field.description = f.description; }
		if ((f.type === 'enum' || f.type === 'multiSelect') && f.options.length > 0) {
			field.options = f.options.map(o => ({ key: o }));
		}
		return field;
	});

	const requestBody: CreateMetadataTemplateRequestBody = {
		scope: 'enterprise',
		displayName: msg.displayName,
		...(msg.templateKey ? { templateKey: msg.templateKey } : {}),
		...(msg.hidden ? { hidden: true } : {}),
		...(msg.copyInstanceOnItemCopy ? { copyInstanceOnItemCopy: true } : {}),
		...(fields.length > 0 ? { fields } : {}),
	};

	try {
		currentPanel?.webview.postMessage({ type: 'status', text: 'Creating template...', level: 'info' });

		const created = await result.client.metadataTemplates.createMetadataTemplate(requestBody);

		log(ext.out, `[Configuration] Created metadata template "${created.templateKey}".`);
		vscode.window.showInformationMessage(`Metadata template "${created.displayName}" created successfully.`);
		vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
		currentPanel?.dispose();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Configuration] Failed to create metadata template: ${message}`);
		currentPanel?.webview.postMessage({ type: 'status', text: `Creation failed: ${message}`, level: 'error' });
		vscode.window.showErrorMessage(`Failed to create template: ${message}`);
	}
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function getWebviewHtml(nonce: string): string {
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
			padding: 20px;
		}
		.header { margin-bottom: 24px; }
		.header h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 8px; }
		.form-row {
			display: flex; align-items: center; gap: 8px;
			margin-bottom: 10px; font-size: 0.95em;
		}
		.form-label { font-weight: 600; min-width: 180px; }
		.inline-input {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 4px 8px;
			font-family: inherit;
			font-size: inherit;
			flex: 1;
			max-width: 400px;
		}
		.inline-input:focus { outline: 1px solid var(--vscode-focusBorder); }
		.inline-input.mono {
			font-family: var(--vscode-editor-font-family, monospace);
		}
		.inline-select {
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--vscode-dropdown-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 3px 4px;
			font-size: inherit;
		}
		.checkbox-row {
			display: flex; align-items: center; gap: 8px;
			margin-bottom: 10px; font-size: 0.95em;
		}
		.checkbox-row label { cursor: pointer; }

		.action-bar { display: flex; gap: 8px; margin-top: 16px; }
		.primary-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none; border-radius: 3px; padding: 6px 14px;
			font-size: 0.9em; cursor: pointer; font-weight: 600;
		}
		.primary-btn:hover { background: var(--vscode-button-hoverBackground); }

		.status-msg {
			margin: 8px 0; padding: 6px 10px; border-radius: 3px;
			font-size: 0.9em; display: none;
		}
		.status-msg.error {
			display: block;
			background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
			border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
		}
		.status-msg.info {
			display: block;
			background: var(--vscode-inputValidation-infoBackground, #063b49);
			border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
		}

		table { width: 100%; border-collapse: collapse; margin-top: 16px; }
		th {
			text-align: left; padding: 8px 10px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			font-weight: 600; font-size: 0.9em;
		}
		td {
			padding: 6px 10px;
			border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
			vertical-align: top;
		}
		tr:hover td { background: var(--vscode-list-hoverBackground); }

		.options-cell { min-width: 160px; }
		.options-list { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
		.option-tag {
			display: inline-flex; align-items: center; gap: 2px;
			padding: 1px 6px; border-radius: 3px; font-size: 0.85em;
			background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.15));
			border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
		}
		.option-x {
			cursor: pointer; font-size: 0.9em; opacity: 0.7;
			background: none; border: none; padding: 0 2px;
			color: var(--vscode-foreground);
		}
		.option-x:hover { opacity: 1; color: var(--vscode-errorForeground, #f44); }
		.option-add { display: inline-flex; gap: 2px; align-items: center; }
		.option-input {
			width: 80px; background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 3px; padding: 1px 4px; font-size: 0.85em;
		}
		.option-add-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none; border-radius: 3px; padding: 1px 6px;
			cursor: pointer; font-size: 0.85em;
		}

		.remove-btn {
			background: none; border: none; cursor: pointer;
			font-size: 1.1em; padding: 2px 6px; border-radius: 3px;
			color: var(--vscode-foreground); opacity: 0.5;
		}
		.remove-btn:hover {
			opacity: 1; color: var(--vscode-errorForeground, #f44);
			background: rgba(255,0,0,0.1);
		}

		.add-field-bar { margin-top: 12px; }
		.add-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.4));
			border-radius: 3px; padding: 6px 14px; cursor: pointer;
			font-size: 0.9em; width: 100%;
		}
		.add-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.section-title { font-size: 1.1em; font-weight: 600; margin-top: 20px; margin-bottom: 4px; }
		.field-count { font-weight: 400; color: var(--vscode-descriptionForeground); }
		.hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: 4px; }
	</style>
</head>
<body>
	<div class="header">
		<h1>Create Metadata Template</h1>
		<div class="form-row">
			<span class="form-label">Display Name <span style="color:var(--vscode-errorForeground)">*</span></span>
			<input class="inline-input" id="display-name" placeholder="My Template" />
		</div>
		<div class="form-row">
			<span class="form-label">Template Key</span>
			<input class="inline-input mono" id="template-key" placeholder="auto-generated from display name" />
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="hidden-cb" />
			<label for="hidden-cb">Hidden</label>
			<span class="hint">(only accessible via API, not shown in Box web UI)</span>
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="copy-cb" />
			<label for="copy-cb">Copy Instance on Item Copy</label>
		</div>
	</div>

	<div id="status-msg" class="status-msg"></div>

	<div class="section-title">Fields <span class="field-count" id="field-count">(0)</span></div>
	<table>
		<thead>
			<tr>
				<th>Type</th>
				<th>Key</th>
				<th>Display Name</th>
				<th>Description</th>
				<th>Options</th>
				<th></th>
			</tr>
		</thead>
		<tbody id="fields-body"></tbody>
	</table>
	<div class="add-field-bar">
		<button class="add-btn" id="add-field-btn">+ Add Field</button>
	</div>

	<div class="action-bar">
		<button class="primary-btn" id="create-btn">Create Template</button>
	</div>

	<script nonce="${nonce}">
	(function() {
		var vscode = acquireVsCodeApi();

		var fields = [];
		var fieldsBody = document.getElementById('fields-body');
		var fieldCount = document.getElementById('field-count');
		var statusEl = document.getElementById('status-msg');

		render();

		function render() {
			fieldCount.textContent = '(' + fields.length + ')';
			fieldsBody.innerHTML = fields.map(function(f, i) {
				var isEnum = f.type === 'enum' || f.type === 'multiSelect';
				var optHtml = '';
				if (isEnum) {
					var tags = f.options.map(function(o, oi) {
						return '<span class="option-tag">' + esc(o) +
							' <button class="option-x" data-fi="' + i + '" data-oi="' + oi + '">&times;</button></span>';
					}).join('');
					optHtml = '<div class="options-list">' + tags +
						'<div class="option-add">' +
						'<input class="option-input" data-fi="' + i + '" placeholder="option" />' +
						'<button class="option-add-btn" data-fi="' + i + '">+</button>' +
						'</div></div>';
				}

				return '<tr>' +
					'<td><select class="inline-select" data-fi="' + i + '" data-prop="type">' +
					opt('string', f.type) + opt('float', f.type) + opt('date', f.type) +
					opt('enum', f.type) + opt('multiSelect', f.type) + '</select></td>' +
					'<td><input class="inline-input mono" data-fi="' + i + '" data-prop="key" value="' + esc(f.key) + '" placeholder="field_key" /></td>' +
					'<td><input class="inline-input" data-fi="' + i + '" data-prop="displayName" value="' + esc(f.displayName) + '" placeholder="Field Name" /></td>' +
					'<td><input class="inline-input" data-fi="' + i + '" data-prop="description" value="' + esc(f.description) + '" placeholder="description" /></td>' +
					'<td class="options-cell">' + optHtml + '</td>' +
					'<td><button class="remove-btn" data-remove="' + i + '" title="Remove field">&times;</button></td>' +
					'</tr>';
			}).join('');
		}

		function opt(val, sel) {
			return '<option value="' + val + '"' + (val === sel ? ' selected' : '') + '>' + val + '</option>';
		}

		function toCamelCase(str) {
			return str.trim()
				.replace(/[^a-zA-Z0-9\s]/g, '')
				.split(/\s+/)
				.map(function(word, i) {
					if (!word) return '';
					if (i === 0) return word.charAt(0).toLowerCase() + word.slice(1);
					return word.charAt(0).toUpperCase() + word.slice(1);
				})
				.join('');
		}

		document.addEventListener('input', function(e) {
			var t = e.target;
			var fi = t.getAttribute('data-fi');
			var prop = t.getAttribute('data-prop');
			if (fi === null || !prop) { return; }
			var idx = parseInt(fi);
			if (prop === 'type') {
				fields[idx][prop] = t.value;
				render();
			} else {
				fields[idx][prop] = t.value;
				if (prop === 'displayName') {
					fields[idx].key = toCamelCase(t.value);
					var keyInput = document.querySelector('input[data-fi="' + idx + '"][data-prop="key"]');
					if (keyInput) keyInput.value = fields[idx].key;
				}
			}
		});

		document.addEventListener('click', function(e) {
			var t = e.target;

			var rb = t.closest('[data-remove]');
			if (rb) {
				fields.splice(parseInt(rb.getAttribute('data-remove')), 1);
				render();
				return;
			}

			var ox = t.closest('.option-x');
			if (ox) {
				var fi = parseInt(ox.getAttribute('data-fi'));
				var oi = parseInt(ox.getAttribute('data-oi'));
				fields[fi].options.splice(oi, 1);
				render();
				return;
			}

			var ab = t.closest('.option-add-btn');
			if (ab) {
				var fi2 = parseInt(ab.getAttribute('data-fi'));
				var inp = document.querySelector('.option-input[data-fi="' + fi2 + '"]');
				var val = inp.value.trim();
				if (val && fields[fi2].options.indexOf(val) === -1) {
					fields[fi2].options.push(val);
					render();
				}
				return;
			}

			if (t.closest('#add-field-btn')) {
				fields.push({ type: 'string', key: '', displayName: '', description: '', options: [] });
				render();
				var rows = fieldsBody.querySelectorAll('tr');
				var last = rows[rows.length - 1];
				if (last) {
					var ki = last.querySelector('[data-prop="key"]');
					if (ki) { ki.focus(); }
				}
				return;
			}

			if (t.closest('#create-btn')) { handleCreate(); return; }
		});

		document.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' && e.target.classList.contains('option-input')) {
				var fi = parseInt(e.target.getAttribute('data-fi'));
				var val = e.target.value.trim();
				if (val && fields[fi].options.indexOf(val) === -1) {
					fields[fi].options.push(val);
					render();
				}
			}
		});

		function handleCreate() {
			var displayName = document.getElementById('display-name').value.trim();
			if (!displayName) {
				showStatus('Display Name is required.', 'error');
				return;
			}
			for (var i = 0; i < fields.length; i++) {
				if (!fields[i].key.trim()) {
					showStatus('All fields must have a key.', 'error');
					return;
				}
				if (!fields[i].displayName.trim()) {
					showStatus('All fields must have a display name.', 'error');
					return;
				}
			}
			showStatus('Creating...', 'info');
			vscode.postMessage({
				type: 'create',
				displayName: displayName,
				templateKey: document.getElementById('template-key').value.trim(),
				hidden: document.getElementById('hidden-cb').checked,
				copyInstanceOnItemCopy: document.getElementById('copy-cb').checked,
				fields: fields,
			});
		}

		function showStatus(text, level) {
			statusEl.textContent = text;
			statusEl.className = 'status-msg ' + level;
		}

		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'status') {
				showStatus(msg.text, msg.level);
			}
		});

		function esc(s) {
			return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
		}
	})();
	</script>
</body>
</html>`;
}
