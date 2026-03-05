import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { CreateMetadataTaxonomyRequestBody } from 'box-node-sdk/lib/managers/metadataTaxonomies';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';
import { getConnection } from '../utils/connectionStorage';

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function openCreateMetadataTaxonomy(): Promise<void> {
	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	// Resolve enterprise namespace
	const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
	const conn = alias ? await getConnection(alias) : undefined;
	const enterpriseId = conn?.enterpriseId ?? '';
	const namespace = enterpriseId ? `enterprise_${enterpriseId}` : '';

	currentPanel = vscode.window.createWebviewPanel(
		'boxCreateMetadataTaxonomy',
		'Create Metadata Taxonomy',
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
	currentPanel.webview.html = getWebviewHtml(nonce, namespace);
}

// ─── Create taxonomy via API ────────────────────────────────────────────────

async function handleCreate(msg: {
	displayName: string;
	key: string;
	namespace: string;
}): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available.');
		return;
	}

	const requestBody: CreateMetadataTaxonomyRequestBody = {
		displayName: msg.displayName,
		namespace: msg.namespace,
		...(msg.key ? { key: msg.key } : {}),
	};

	try {
		currentPanel?.webview.postMessage({ type: 'status', text: 'Creating taxonomy...', level: 'info' });

		const created = await result.client.metadataTaxonomies.createMetadataTaxonomy(requestBody);

		log(ext.out, `[Configuration] Created metadata taxonomy "${created.key}".`);
		vscode.window.showInformationMessage(`Metadata taxonomy "${created.displayName}" created successfully.`);
		vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
		currentPanel?.dispose();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Configuration] Failed to create metadata taxonomy: ${message}`);
		currentPanel?.webview.postMessage({ type: 'status', text: `Creation failed: ${message}`, level: 'error' });
		vscode.window.showErrorMessage(`Failed to create taxonomy: ${message}`);
	}
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function getWebviewHtml(nonce: string, namespace: string): string {
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
		.form-label { font-weight: 600; min-width: 140px; }
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
		.inline-input:read-only {
			opacity: 0.7;
			cursor: default;
		}

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
		.hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: 4px; }
	</style>
</head>
<body>
	<div class="header">
		<h1>Create Metadata Taxonomy</h1>
		<div class="form-row">
			<span class="form-label">Display Name <span style="color:var(--vscode-errorForeground)">*</span></span>
			<input class="inline-input" id="display-name" placeholder="My Taxonomy" />
		</div>
		<div class="form-row">
			<span class="form-label">Key</span>
			<input class="inline-input mono" id="taxonomy-key" placeholder="auto-generated from display name" />
		</div>
		<div class="form-row">
			<span class="form-label">Namespace</span>
			<input class="inline-input mono" id="namespace" value="${esc(namespace)}" readonly />
			<span class="hint">(derived from enterprise ID)</span>
		</div>
	</div>

	<div id="status-msg" class="status-msg"></div>

	<div class="action-bar">
		<button class="primary-btn" id="create-btn">Create Taxonomy</button>
	</div>

	<script nonce="${nonce}">
	(function() {
		var vscode = acquireVsCodeApi();
		var statusEl = document.getElementById('status-msg');

		document.getElementById('create-btn').addEventListener('click', function() {
			var displayName = document.getElementById('display-name').value.trim();
			var namespace = document.getElementById('namespace').value.trim();
			if (!displayName) {
				showStatus('Display Name is required.', 'error');
				return;
			}
			if (!namespace) {
				showStatus('Namespace is required. Ensure your connection has an enterprise ID.', 'error');
				return;
			}
			showStatus('Creating...', 'info');
			vscode.postMessage({
				type: 'create',
				displayName: displayName,
				key: document.getElementById('taxonomy-key').value.trim(),
				namespace: namespace,
			});
		});

		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'status') {
				showStatus(msg.text, msg.level);
			}
		});

		function showStatus(text, level) {
			statusEl.textContent = text;
			statusEl.className = 'status-msg ' + level;
		}
	})();
	</script>
</body>
</html>`;
}
