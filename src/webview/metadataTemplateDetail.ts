import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MetadataTemplate } from 'box-node-sdk/lib/schemas/metadataTemplate';
import { UpdateMetadataTemplateRequestBody } from 'box-node-sdk/lib/managers/metadataTemplates';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;
let currentTemplate: MetadataTemplate | undefined;

// ─── Webview field data shape ────────────────────────────────────────────────

interface FieldData {
	key: string;
	displayName: string;
	type: string;
	description: string;
	hidden: boolean;
	options: string[];
	isNew: boolean;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function openMetadataTemplateDetail(template: MetadataTemplate): void {
	currentTemplate = template;
	const title = template.displayName ?? template.templateKey ?? 'Metadata Template';

	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.One);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'boxMetadataTemplateDetail',
			title,
			vscode.ViewColumn.One,
			{ enableScripts: true },
		);
		currentPanel.onDidDispose(() => {
			currentPanel = undefined;
			currentTemplate = undefined;
			messageListener?.dispose();
			messageListener = undefined;
		});
	}

	messageListener?.dispose();
	messageListener = currentPanel.webview.onDidReceiveMessage(async (msg) => {
		if (msg.type === 'copy') {
			await vscode.env.clipboard.writeText(msg.text);
			vscode.window.showInformationMessage(`Copied: ${msg.text}`);
		} else if (msg.type === 'saveJson') {
			if (currentTemplate) { await saveTemplateJson(currentTemplate); }
		} else if (msg.type === 'updateTemplate') {
			await handleUpdateTemplate(msg);
		} else if (msg.type === 'deleteTemplate') {
			await handleDeleteTemplate();
		}
	});

	const nonce = crypto.randomBytes(16).toString('hex');
	currentPanel.webview.html = getWebviewHtml(template, nonce);
}

// ─── Update template via API ─────────────────────────────────────────────────

async function handleUpdateTemplate(msg: {
	displayName: string;
	fields: FieldData[];
	removedFieldKeys: string[];
}): Promise<void> {
	if (!currentTemplate) { return; }

	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available.');
		return;
	}

	const operations = buildUpdateOperations(currentTemplate, msg);
	if (operations.length === 0) {
		currentPanel?.webview.postMessage({ type: 'status', text: 'No changes detected.', level: 'info' });
		return;
	}

	const scope = currentTemplate.scope === 'global' ? 'global' : 'enterprise';
	const templateKey = currentTemplate.templateKey ?? '';

	try {
		const updated = await result.client.metadataTemplates.updateMetadataTemplate(
			scope, templateKey, operations,
		);

		currentTemplate = updated;
		currentPanel?.webview.postMessage({
			type: 'templateUpdated',
			template: templateToWebviewData(updated),
		});

		vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
		log(ext.out, `[Configuration] Updated metadata template "${templateKey}" (${operations.length} operations)`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Configuration] Failed to update template "${templateKey}": ${message}`);
		currentPanel?.webview.postMessage({ type: 'status', text: `Update failed: ${message}`, level: 'error' });
		vscode.window.showErrorMessage(`Failed to update template: ${message}`);
	}
}

// ─── Delete template via API ────────────────────────────────────────────────

async function handleDeleteTemplate(): Promise<void> {
	if (!currentTemplate) { return; }

	const templateKey = currentTemplate.templateKey ?? '';
	const displayName = currentTemplate.displayName ?? templateKey;

	const confirm = await vscode.window.showWarningMessage(
		`Are you sure you want to delete the metadata template "${displayName}"? This action cannot be undone.`,
		{ modal: true },
		'Delete',
	);
	if (confirm !== 'Delete') { return; }

	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available.');
		return;
	}

	const scope = currentTemplate.scope === 'global' ? 'global' : 'enterprise';

	try {
		await result.client.metadataTemplates.deleteMetadataTemplate(scope, templateKey);
		log(ext.out, `[Configuration] Deleted metadata template "${templateKey}".`);
		vscode.window.showInformationMessage(`Metadata template "${displayName}" deleted.`);
		vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
		currentPanel?.dispose();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Configuration] Failed to delete template "${templateKey}": ${message}`);
		currentPanel?.webview.postMessage({ type: 'status', text: `Delete failed: ${message}`, level: 'error' });
		vscode.window.showErrorMessage(`Failed to delete template: ${message}`);
	}
}

function buildUpdateOperations(
	original: MetadataTemplate,
	modified: { displayName: string; fields: FieldData[]; removedFieldKeys: string[] },
): UpdateMetadataTemplateRequestBody[] {
	const ops: UpdateMetadataTemplateRequestBody[] = [];

	// 1. Template display name change
	if (modified.displayName !== (original.displayName ?? '')) {
		ops.push({ op: 'editTemplate', data: { displayName: modified.displayName } });
	}

	// 2. Remove deleted fields
	for (const key of modified.removedFieldKeys) {
		ops.push({ op: 'removeField', fieldKey: key });
	}

	// 3. Add new fields
	for (const field of modified.fields) {
		if (!field.isNew) { continue; }
		const addData: Record<string, unknown> = {
			type: field.type,
			key: field.key,
			displayName: field.displayName,
		};
		if (field.description) { addData.description = field.description; }
		if (field.hidden) { addData.hidden = true; }
		if ((field.type === 'enum' || field.type === 'multiSelect') && field.options.length > 0) {
			addData.options = field.options.map(o => ({ key: o }));
		}
		ops.push({ op: 'addField', data: addData });
	}

	// 4. Edit existing fields
	const originalFields = new Map((original.fields ?? []).map(f => [f.key, f]));

	for (const field of modified.fields) {
		if (field.isNew) { continue; }
		const orig = originalFields.get(field.key);
		if (!orig) { continue; }

		// Display name / description changes
		const editData: Record<string, unknown> = {};
		if (field.displayName !== orig.displayName) { editData.displayName = field.displayName; }
		if ((field.description || '') !== (orig.description || '')) { editData.description = field.description; }

		if (Object.keys(editData).length > 0) {
			ops.push({ op: 'editField', fieldKey: field.key, data: editData });
		}

		// Enum / multiSelect option changes
		if (field.type === 'enum' || field.type === 'multiSelect') {
			const origOpts = new Set((orig.options ?? []).map(o => o.key));
			const newOpts = new Set(field.options);

			for (const opt of field.options) {
				if (!origOpts.has(opt)) {
					ops.push(field.type === 'enum'
						? { op: 'addEnumOption', fieldKey: field.key, data: { key: opt } }
						: { op: 'addMultiSelectOption', fieldKey: field.key, data: { key: opt } },
					);
				}
			}
			for (const opt of origOpts) {
				if (!newOpts.has(opt)) {
					ops.push(field.type === 'enum'
						? { op: 'removeEnumOption', fieldKey: field.key, enumOptionKey: opt }
						: { op: 'removeMultiSelectOption', fieldKey: field.key, multiSelectOptionKey: opt },
					);
				}
			}
		}
	}

	return ops;
}

// ─── Save template JSON ─────────────────────────────────────────────────────

export async function saveTemplateJson(template: MetadataTemplate): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	const root = workspaceFolders[0].uri;
	const dirUri = vscode.Uri.joinPath(root, 'metadata-templates');

	try { await vscode.workspace.fs.createDirectory(dirUri); } catch { /* exists */ }

	const json = buildTemplateJson(template);
	const fileName = `${template.templateKey ?? 'template'}.json`;
	const fileUri = vscode.Uri.joinPath(dirUri, fileName);

	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(json, null, 2), 'utf-8'));
	log(ext.out, `[Configuration] Saved metadata template to ${fileUri.fsPath}`);
	vscode.window.showInformationMessage(`Saved: metadata-templates/${fileName}`);

	const doc = await vscode.workspace.openTextDocument(fileUri);
	await vscode.window.showTextDocument(doc, { preview: false });
}

function buildTemplateJson(template: MetadataTemplate): Record<string, unknown> {
	const fields = (template.fields ?? []).map(f => {
		const field: Record<string, unknown> = {
			type: f.type,
			key: f.key,
			displayName: f.displayName,
		};
		if (f.description) { field.description = f.description; }
		if (f.hidden) { field.hidden = f.hidden; }
		if (f.options && (f.type === 'enum' || f.type === 'multiSelect')) {
			field.options = f.options.map(o => ({ key: o.key }));
		}
		return field;
	});

	return {
		scope: template.scope?.startsWith('enterprise') ? 'enterprise' : (template.scope ?? 'enterprise'),
		templateKey: template.templateKey ?? '',
		displayName: template.displayName ?? '',
		hidden: template.hidden ?? false,
		fields,
		copyInstanceOnItemCopy: template.copyInstanceOnItemCopy ?? false,
	};
}

// ─── Data conversion ─────────────────────────────────────────────────────────

function templateToWebviewData(t: MetadataTemplate): object {
	return {
		displayName: t.displayName ?? '',
		templateKey: t.templateKey ?? '',
		scope: t.scope ?? '',
		hidden: t.hidden ?? false,
		fields: (t.fields ?? []).map(f => ({
			key: f.key,
			displayName: f.displayName,
			type: f.type,
			description: f.description ?? '',
			hidden: f.hidden ?? false,
			options: (f.options ?? []).map(o => o.key),
		})),
	};
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function getWebviewHtml(template: MetadataTemplate, nonce: string): string {
	const scope = template.scope ?? '';
	const templateKey = template.templateKey ?? '';
	const data = templateToWebviewData(template);
	const dataJson = JSON.stringify(data).replace(/<\//g, '<\\/');

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
		.meta-row {
			display: flex; align-items: center; gap: 8px;
			margin-bottom: 6px; font-size: 0.95em;
			color: var(--vscode-descriptionForeground);
		}
		.meta-label { font-weight: 600; min-width: 100px; }

		.inline-input {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 3px 6px;
			font-family: inherit;
			font-size: inherit;
			width: 100%;
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

		.copy-btn {
			display: inline-flex; align-items: center; gap: 4px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none; border-radius: 3px; padding: 2px 8px;
			font-size: 0.85em; cursor: pointer;
			font-family: var(--vscode-editor-font-family, monospace);
		}
		.copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

		.action-bar { display: flex; gap: 8px; margin-top: 12px; }
		.primary-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none; border-radius: 3px; padding: 6px 14px;
			font-size: 0.9em; cursor: pointer; font-weight: 600;
		}
		.primary-btn:hover { background: var(--vscode-button-hoverBackground); }
		.secondary-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none; border-radius: 3px; padding: 6px 14px;
			font-size: 0.9em; cursor: pointer;
		}
		.secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.danger-btn {
			background: var(--vscode-errorForeground, #f44);
			color: #fff;
			border: none; border-radius: 3px; padding: 6px 14px;
			font-size: 0.9em; cursor: pointer; font-weight: 600;
			margin-left: auto;
		}
		.danger-btn:hover { opacity: 0.85; }

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
		.status-msg.success {
			display: block;
			background: var(--vscode-terminal-ansiGreen, #1b5e20);
			color: #fff; border: 1px solid rgba(255,255,255,0.2);
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

		.type-badge {
			display: inline-block; padding: 1px 8px; border-radius: 10px;
			font-size: 0.85em; font-weight: 500;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}
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
	</style>
</head>
<body>
	<div class="header">
		<h1>Metadata Template</h1>
		<div class="meta-row">
			<span class="meta-label">Display Name:</span>
			<input class="inline-input" id="template-name" style="max-width:300px" />
		</div>
		<div class="meta-row">
			<span class="meta-label">Scope:</span>
			<span>${esc(scope)}</span>
		</div>
		<div class="meta-row">
			<span class="meta-label">Template Key:</span>
			<button class="copy-btn" data-copy="${esc(templateKey)}">${esc(templateKey)} &#x2398;</button>
		</div>
		<div class="action-bar">
			<button class="primary-btn" id="update-btn">Update Template</button>
			<button class="secondary-btn" id="save-json-btn">Save JSON</button>
			<button class="danger-btn" id="delete-btn">Delete Template</button>
		</div>
	</div>

	<div id="status-msg" class="status-msg"></div>

	<div class="section-title">Fields <span class="field-count" id="field-count"></span></div>
	<table>
		<thead>
			<tr>
				<th>Display Name</th>
				<th>Key</th>
				<th>Type</th>
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

	<script nonce="${nonce}">
	(function() {
		const vscode = acquireVsCodeApi();
		const INIT = ${dataJson};

		// ── State ──
		let displayName = INIT.displayName;
		let fields = INIT.fields.map(function(f) {
			return {
				key: f.key, displayName: f.displayName, type: f.type,
				description: f.description || '', hidden: f.hidden || false,
				options: (f.options || []).slice(), isNew: false,
			};
		});
		let removedKeys = [];

		const nameInput = document.getElementById('template-name');
		const fieldsBody = document.getElementById('fields-body');
		const fieldCount = document.getElementById('field-count');
		const statusEl = document.getElementById('status-msg');

		nameInput.value = displayName;
		render();

		// ── Render ──
		function render() {
			fieldCount.textContent = '(' + fields.length + ')';
			fieldsBody.innerHTML = fields.map(function(f, i) {
				const isEnum = f.type === 'enum' || f.type === 'multiSelect';
				let optHtml = '';
				if (isEnum) {
					const tags = f.options.map(function(o, oi) {
						return '<span class="option-tag">' + esc(o) +
							' <button class="option-x" data-fi="' + i + '" data-oi="' + oi + '">&times;</button></span>';
					}).join('');
					optHtml = '<div class="options-list">' + tags +
						'<div class="option-add">' +
						'<input class="option-input" data-fi="' + i + '" placeholder="option" />' +
						'<button class="option-add-btn" data-fi="' + i + '">+</button>' +
						'</div></div>';
				}

				const keyCell = f.isNew
					? '<input class="inline-input mono" data-fi="' + i + '" data-prop="key" value="' + esc(f.key) + '" placeholder="field_key" />'
					: '<button class="copy-btn" data-copy="' + esc(f.key) + '">' + esc(f.key) + ' &#x2398;</button>';

				const typeCell = f.isNew
					? '<select class="inline-select" data-fi="' + i + '" data-prop="type">' +
					  opt('string', f.type) + opt('float', f.type) + opt('date', f.type) +
					  opt('enum', f.type) + opt('multiSelect', f.type) + '</select>'
					: '<span class="type-badge">' + esc(f.type) + '</span>';

				return '<tr>' +
					'<td><input class="inline-input" data-fi="' + i + '" data-prop="displayName" value="' + esc(f.displayName) + '" /></td>' +
					'<td class="key-cell">' + keyCell + '</td>' +
					'<td>' + typeCell + '</td>' +
					'<td><input class="inline-input" data-fi="' + i + '" data-prop="description" value="' + esc(f.description) + '" placeholder="description" /></td>' +
					'<td class="options-cell">' + optHtml + '</td>' +
					'<td><button class="remove-btn" data-remove="' + i + '" title="Remove field">&times;</button></td>' +
					'</tr>';
			}).join('');
		}

		function opt(val, sel) {
			return '<option value="' + val + '"' + (val === sel ? ' selected' : '') + '>' + val + '</option>';
		}

		// ── Events ──
		nameInput.addEventListener('input', function() { displayName = nameInput.value; });

		document.addEventListener('input', function(e) {
			var t = e.target;
			var fi = t.getAttribute('data-fi');
			var prop = t.getAttribute('data-prop');
			if (fi === null || !prop) return;
			var idx = parseInt(fi);
			if (prop === 'type') {
				fields[idx][prop] = t.value;
				render();
			} else {
				fields[idx][prop] = t.value;
			}
		});

		document.addEventListener('click', function(e) {
			var t = e.target;

			// Copy
			var cb = t.closest('[data-copy]');
			if (cb) { vscode.postMessage({ type: 'copy', text: cb.getAttribute('data-copy') }); return; }

			// Remove field
			var rb = t.closest('[data-remove]');
			if (rb) {
				var idx = parseInt(rb.getAttribute('data-remove'));
				var f = fields[idx];
				if (!f.isNew) removedKeys.push(f.key);
				fields.splice(idx, 1);
				render();
				return;
			}

			// Remove option
			var ox = t.closest('.option-x');
			if (ox) {
				var fi = parseInt(ox.getAttribute('data-fi'));
				var oi = parseInt(ox.getAttribute('data-oi'));
				fields[fi].options.splice(oi, 1);
				render();
				return;
			}

			// Add option
			var ab = t.closest('.option-add-btn');
			if (ab) {
				var fi = parseInt(ab.getAttribute('data-fi'));
				var inp = document.querySelector('.option-input[data-fi="' + fi + '"]');
				var val = inp.value.trim();
				if (val && fields[fi].options.indexOf(val) === -1) {
					fields[fi].options.push(val);
					render();
				}
				return;
			}

			// Add field
			if (t.closest('#add-field-btn')) {
				fields.push({
					key: '', displayName: '', type: 'string',
					description: '', hidden: false, options: [], isNew: true,
				});
				render();
				// Focus the new key input
				var rows = fieldsBody.querySelectorAll('tr');
				var last = rows[rows.length - 1];
				if (last) {
					var ki = last.querySelector('[data-prop="key"]');
					if (ki) ki.focus();
				}
				return;
			}

			// Update template
			if (t.closest('#update-btn')) { handleUpdate(); return; }

			// Save JSON
			if (t.closest('#save-json-btn')) { vscode.postMessage({ type: 'saveJson' }); return; }

			// Delete template
			if (t.closest('#delete-btn')) { vscode.postMessage({ type: 'deleteTemplate' }); return; }
		});

		// Allow Enter in option input to add
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

		function handleUpdate() {
			// Validate
			for (var i = 0; i < fields.length; i++) {
				if (fields[i].isNew && !fields[i].key.trim()) {
					showStatus('New fields must have a key.', 'error'); return;
				}
				if (fields[i].isNew && !fields[i].displayName.trim()) {
					showStatus('New fields must have a display name.', 'error'); return;
				}
			}
			showStatus('Updating...', 'info');
			vscode.postMessage({
				type: 'updateTemplate',
				displayName: displayName,
				fields: fields,
				removedFieldKeys: removedKeys,
			});
		}

		function showStatus(text, level) {
			statusEl.textContent = text;
			statusEl.className = 'status-msg ' + level;
		}

		// ── Messages from extension ──
		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'templateUpdated') {
				var t = msg.template;
				displayName = t.displayName;
				nameInput.value = displayName;
				fields = t.fields.map(function(f) {
					return {
						key: f.key, displayName: f.displayName, type: f.type,
						description: f.description || '', hidden: f.hidden || false,
						options: (f.options || []).slice(), isNew: false,
					};
				});
				removedKeys = [];
				render();
				showStatus('Template updated successfully!', 'success');
			} else if (msg.type === 'status') {
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

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
