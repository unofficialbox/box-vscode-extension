import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MetadataQuery } from 'box-node-sdk/lib/schemas/metadataQuery';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';
import { getConnection } from '../utils/connectionStorage';

let currentPanel: vscode.WebviewPanel | undefined;

// ─── Public API ──────────────────────────────────────────────────────────────

export function openMetadataQueryBuilder(): void {
	const extensionUri = ext.context.extensionUri;
	const elementsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-ui-elements', 'dist');
	const resourcesDir = vscode.Uri.joinPath(extensionUri, 'resources');

	currentPanel = vscode.window.createWebviewPanel(
		'boxMetadataQueryBuilder',
		'Metadata Query Builder',
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [elementsDir, resourcesDir],
		},
	);

	const panel = currentPanel;

	panel.onDidDispose(() => {
		if (currentPanel === panel) {
			currentPanel = undefined;
		}
	});

	const listener = panel.webview.onDidReceiveMessage(async (msg) => {
		if (msg.type === 'execute') {
			log(ext.out, `[MetadataQuery] Received execute message: ${JSON.stringify(msg)}`);
			await handleExecute(msg, panel);
		} else if (msg.type === 'copyJson') {
			await vscode.env.clipboard.writeText(msg.text);
			vscode.window.showInformationMessage('Request JSON copied to clipboard.');
		} else if (msg.type === 'fetchTemplates') {
			await handleFetchTemplates(panel);
		} else if (msg.type === 'api-proxy') {
			await handleApiProxy(msg, panel);
		}
	});

	panel.onDidDispose(() => {
		listener.dispose();
	});

	const nonce = crypto.randomBytes(16).toString('hex');
	const webview = panel.webview;

	const explorerJs = webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'explorer.js'));
	const explorerCss = webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'explorer.css'));
	const shimJs = webview.asWebviewUri(vscode.Uri.joinPath(resourcesDir, 'apiProxyShim.js'));

	panel.webview.html = getWebviewHtml(nonce, webview, explorerJs, explorerCss, shimJs);

	// Auto-fetch templates on open
	handleFetchTemplates(panel);
}

// ─── Fetch enterprise metadata templates ────────────────────────────────────

async function handleFetchTemplates(panel: vscode.WebviewPanel): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		panel.webview.postMessage({ type: 'status', text: 'No Box connection available.', level: 'error' });
		return;
	}

	const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
	const conn = alias ? await getConnection(alias) : undefined;
	const enterpriseId = conn?.enterpriseId ?? '';

	try {
		const response = await result.client.metadataTemplates.getEnterpriseMetadataTemplates();
		const entries = response.entries ?? [];
		const templates = entries
			.filter(t => !!t.displayName && !!t.templateKey)
			.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
			.map(t => ({
				templateKey: t.templateKey ?? '',
				displayName: t.displayName ?? '',
				scope: t.scope ?? 'enterprise',
				fields: (t.fields ?? []).map(f => ({
					key: f.key ?? '',
					displayName: f.displayName ?? '',
					type: f.type ?? 'string',
				})),
			}));

		log(ext.out, `[MetadataQuery] Fetched ${templates.length} enterprise templates.`);
		panel.webview.postMessage({ type: 'templates', templates, enterpriseId });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[MetadataQuery] Failed to fetch templates: ${message}`);
		panel.webview.postMessage({ type: 'status', text: `Failed to fetch templates: ${message}`, level: 'error' });
	}
}

// ─── Execute metadata query via API ─────────────────────────────────────────

async function handleExecute(msg: {
	from: string;
	ancestorFolderId: string;
	query: string;
	queryParams: { key: string; value: string }[];
	orderBy: { fieldKey: string; direction: string }[];
	fields: string;
	limit: string;
	marker: string;
}, panel: vscode.WebviewPanel): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available.');
		return;
	}

	log(ext.out, `[MetadataQuery] Execute request — from: "${msg.from}", ancestorFolderId: "${msg.ancestorFolderId}", fields: "${msg.fields}"`);

	const requestBody: MetadataQuery = {
		from: msg.from,
		ancestorFolderId: msg.ancestorFolderId,
		...(msg.query ? { query: msg.query } : {}),
		...(msg.queryParams.length > 0 ? {
			queryParams: Object.fromEntries(msg.queryParams.map(p => [p.key, p.value])),
		} : {}),
		...(msg.orderBy.length > 0 ? {
			orderBy: msg.orderBy.map(o => ({ fieldKey: o.fieldKey, direction: o.direction as 'ASC' | 'DESC' })),
		} : {}),
		...(msg.fields ? { fields: msg.fields.split(',').map(f => f.trim()).filter(Boolean).map(f => f.startsWith('metadata.') ? f : `metadata.${f}`) } : {}),
		...(msg.limit ? { limit: parseInt(msg.limit, 10) } : {}),
		...(msg.marker ? { marker: msg.marker } : {}),
	};

	try {
		panel.webview.postMessage({ type: 'status', text: 'Executing query...', level: 'info' });

		const results = await result.client.search.searchByMetadataQuery(requestBody);

		log(ext.out, `[MetadataQuery] Query executed: ${results.entries?.length ?? 0} results returned.`);

		// Use the full (non-downscoped) token for the UI Element tab.
		// The metadata view requires full token scopes — downscoped tokens
		// return 400 invalid_token errors for metadata queries.
		const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
		const conn = alias ? await getConnection(alias) : undefined;
		const fullAccessToken = conn?.accessToken ?? '';

		panel.webview.postMessage({
			type: 'results',
			data: results,
			nextMarker: results.nextMarker ?? '',
			accessToken: fullAccessToken,
			ancestorFolderId: msg.ancestorFolderId,
			from: msg.from,
			query: msg.query,
			queryParams: msg.queryParams.length > 0
				? Object.fromEntries(msg.queryParams.map(p => [p.key, p.value]))
				: null,
			fields: msg.fields
				? msg.fields.split(',').map(f => f.trim()).filter(Boolean)
					.map(f => f.startsWith('metadata.') ? f : `metadata.${f}`).join(',')
				: '',
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[MetadataQuery] Query failed: ${message}`);
		panel.webview.postMessage({ type: 'status', text: `Query failed: ${message}`, level: 'error' });
		vscode.window.showErrorMessage(`Metadata query failed: ${message}`);
	}
}

// ─── API proxy for Content Explorer ─────────────────────────────────────────

async function handleApiProxy(msg: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }, panel: vscode.WebviewPanel): Promise<void> {
	try {
		if (msg.url.includes('metadata_queries')) {
			log(ext.out, `[MetadataQuery] API Proxy — ${msg.method} ${msg.url} body: ${msg.body}`);
		}
		const resp = await fetch(msg.url, {
			method: msg.method,
			headers: msg.headers,
			body: msg.body || undefined,
		});

		const responseHeaders: Record<string, string> = {};
		resp.headers.forEach((v, k) => { responseHeaders[k] = v; });

		const contentType = resp.headers.get('content-type') || '';
		let responseBody: string;
		let isBinary = false;

		if (contentType.startsWith('application/json') || contentType.startsWith('text/')) {
			responseBody = await resp.text();
		} else {
			const buf = Buffer.from(await resp.arrayBuffer());
			responseBody = buf.toString('base64');
			isBinary = true;
		}

		panel.webview.postMessage({
			type: 'api-proxy-response',
			id: msg.id,
			status: resp.status,
			statusText: resp.statusText,
			headers: responseHeaders,
			body: responseBody,
			isBinary,
		});
	} catch (err) {
		panel.webview.postMessage({
			type: 'api-proxy-response',
			id: msg.id,
			status: 0,
			statusText: String(err),
			headers: {},
			body: '',
			isBinary: false,
		});
	}
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function getWebviewHtml(
	nonce: string,
	webview: vscode.Webview,
	explorerJs: vscode.Uri,
	explorerCss: vscode.Uri,
	shimJs: vscode.Uri,
): string {
	const cspSource = webview.cspSource;
	const csp = [
		`default-src 'none'`,
		`style-src 'unsafe-inline' ${cspSource} https://cdn01.boxcdn.net`,
		`script-src 'nonce-${nonce}' ${cspSource} https://cdn01.boxcdn.net`,
		`img-src https: data: blob:`,
		`media-src https: blob:`,
		`font-src ${cspSource} https://cdn01.boxcdn.net data:`,
		`connect-src https://cdn01.boxcdn.net`,
		`frame-src https://*.box.com https://*.boxcloud.com blob:`,
		`worker-src blob:`,
	].join('; ');

	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<link rel="stylesheet" href="${explorerCss}">
	<style nonce="${nonce}">
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family, sans-serif);
			font-size: var(--vscode-font-size, 13px);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			padding: 20px;
		}
		.header { margin-bottom: 20px; }
		.header h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 4px; }
		.header p { color: var(--vscode-descriptionForeground); font-size: 0.9em; }

		.form-row {
			display: flex; align-items: center; gap: 8px;
			margin-bottom: 10px; font-size: 0.95em;
		}
		.form-label { font-weight: 600; min-width: 160px; flex-shrink: 0; }
		.inline-input {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 4px 8px;
			font-family: inherit;
			font-size: inherit;
			flex: 1;
			max-width: 500px;
		}
		.inline-input:focus { outline: 1px solid var(--vscode-focusBorder); }
		.inline-input.mono {
			font-family: var(--vscode-editor-font-family, monospace);
		}
		.inline-input.narrow { max-width: 100px; }
		.inline-select {
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--vscode-dropdown-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 3px 4px;
			font-size: inherit;
		}
		.hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: 4px; }

		.section-title { font-size: 1em; font-weight: 600; margin-top: 16px; margin-bottom: 6px; }

		.dynamic-rows { margin-bottom: 8px; }
		.dynamic-row {
			display: flex; align-items: center; gap: 6px;
			margin-bottom: 6px;
		}
		.dynamic-row .inline-input { max-width: 220px; }
		.remove-btn {
			background: none; border: none; cursor: pointer;
			font-size: 1.1em; padding: 2px 6px; border-radius: 3px;
			color: var(--vscode-foreground); opacity: 0.5;
		}
		.remove-btn:hover {
			opacity: 1; color: var(--vscode-errorForeground, #f44);
			background: rgba(255,0,0,0.1);
		}
		.add-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.4));
			border-radius: 3px; padding: 4px 12px; cursor: pointer;
			font-size: 0.85em;
		}
		.add-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

		.action-bar { display: flex; gap: 8px; margin-top: 16px; }
		.primary-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none; border-radius: 3px; padding: 6px 14px;
			font-size: 0.9em; cursor: pointer; font-weight: 600;
		}
		.primary-btn:hover { background: var(--vscode-button-hoverBackground); }
		.primary-btn:disabled { opacity: 0.5; cursor: default; }
		.secondary-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none; border-radius: 3px; padding: 6px 14px;
			font-size: 0.9em; cursor: pointer;
		}
		.secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

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

		.template-dropdown {
			background: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--vscode-dropdown-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 4px 8px;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: inherit;
			max-width: 500px;
			flex: 1;
		}

		/* ─── Dual list (Fields) ──────────────────────── */
		.dual-list {
			display: flex; gap: 8px; align-items: stretch;
			margin-bottom: 8px; max-width: 660px;
		}
		.dual-list-panel {
			flex: 1; display: flex; flex-direction: column;
		}
		.dual-list-panel label {
			font-weight: 600; font-size: 0.85em; margin-bottom: 4px;
			color: var(--vscode-descriptionForeground);
		}
		.dual-list-panel select {
			flex: 1;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 4px;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.85em;
			min-height: 120px;
		}
		.dual-list-actions {
			display: flex; flex-direction: column; justify-content: center; gap: 4px;
		}
		.dual-list-actions button {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none; border-radius: 3px; padding: 4px 10px;
			cursor: pointer; font-size: 0.9em;
		}
		.dual-list-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }

		/* ─── Tab bar ─────────────────────────────────── */
		.tab-bar {
			display: none; margin-top: 24px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
		}
		.tab-bar button {
			background: none; border: none; border-bottom: 2px solid transparent;
			color: var(--vscode-descriptionForeground);
			padding: 8px 16px; cursor: pointer; font-size: 0.95em; font-weight: 600;
		}
		.tab-bar button.active {
			color: var(--vscode-foreground);
			border-bottom-color: var(--vscode-focusBorder, #007acc);
		}
		.tab-bar button:hover { color: var(--vscode-foreground); }

		.tab-content { display: none; }
		.tab-content.active { display: block; }

		.results-header {
			font-size: 1.1em; font-weight: 600; margin-top: 12px; margin-bottom: 8px;
			display: none;
			align-items: center; gap: 12px;
		}
		.results-header .count {
			font-weight: 400; color: var(--vscode-descriptionForeground);
		}
		.results-filter {
			margin-left: auto;
			display: flex; align-items: center; gap: 6px;
			font-size: 0.82rem; font-weight: 400;
		}
		.results-filter input {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 3px;
			padding: 3px 8px;
			font-family: inherit;
			font-size: inherit;
			width: 200px;
		}
		.results-filter input:focus { outline: 1px solid var(--vscode-focusBorder); }
		.results-filter input::placeholder { color: var(--vscode-input-placeholderForeground); }
		.results-block {
			background: #1e1e2e;
			border: 1px solid #313244;
			border-radius: 8px;
			padding: 18px 22px;
			font-family: var(--vscode-editor-font-family, 'SF Mono', SFMono-Regular, Consolas, monospace);
			font-size: 0.82rem;
			line-height: 1.6;
			color: #cdd6f4;
			overflow: auto;
			max-height: 500px;
			white-space: pre;
			display: none;
		}

		.explorer-container {
			height: 600px;
			margin: 12px 0 0;
			box-sizing: border-box;
		}
		.bce-ContentExplorer-main {
			padding: 0 20px;
		}
		.explorer-placeholder {
			color: var(--vscode-descriptionForeground);
			padding: 20px;
			text-align: center;
			font-size: 0.9em;
		}

		/* ─── Accordion ──────────────────────────────── */
		.accordion {
			border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
			border-radius: 4px;
			margin-bottom: 12px;
			overflow: hidden;
		}
		#accordion-results { overflow: visible; }
	#accordion-results > .accordion-body { overflow: visible; }
		.accordion-header {
			display: flex; align-items: center; gap: 8px;
			padding: 10px 14px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			cursor: pointer; user-select: none;
			font-weight: 600; font-size: 0.95em;
			border: none; width: 100%; text-align: left;
			color: var(--vscode-foreground);
		}
		.accordion-header:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.accordion-chevron {
			display: inline-block; transition: transform 0.15s;
			font-size: 0.8em; width: 16px; text-align: center;
		}
		.accordion.collapsed .accordion-chevron { transform: rotate(-90deg); }
		.accordion-body {
			padding: 16px 14px;
		}
		.accordion.collapsed .accordion-body { display: none; }

		/* ─── Typeahead ───────────────────────────────── */
		.typeahead-wrap {
			position: relative; flex: 1; max-width: 500px;
		}
		.typeahead-wrap .inline-input { width: 100%; max-width: none; }
		.typeahead-list {
			display: none; position: absolute; top: 100%; left: 0; right: 0;
			z-index: 100; max-height: 180px; overflow-y: auto;
			background: var(--vscode-editorSuggestWidget-background, var(--vscode-dropdown-background));
			border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-dropdown-border, rgba(128,128,128,0.3)));
			border-radius: 0 0 3px 3px;
			box-shadow: 0 4px 8px rgba(0,0,0,0.25);
		}
		.typeahead-list.open { display: block; }
		.typeahead-item {
			padding: 4px 8px; cursor: pointer;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 0.9em; white-space: nowrap;
		}
		.typeahead-item:hover, .typeahead-item.active {
			background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-hoverBackground));
			color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-foreground));
		}
		.typeahead-item .field-type {
			color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: 8px;
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>Metadata Query Builder</h1>
		<p>Build and execute queries against the Box Metadata Query API</p>
	</div>

	<div class="accordion" id="accordion-query">
		<button class="accordion-header" id="accordion-query-header">
			<span class="accordion-chevron">&#9660;</span> Query Builder
		</button>
		<div class="accordion-body">
			<div class="form-row">
				<span class="form-label">From <span style="color:var(--vscode-errorForeground)">*</span></span>
				<select class="template-dropdown" id="template-dropdown">
					<option value="">Loading templates...</option>
				</select>
				<button class="secondary-btn" id="fetch-templates-btn">Refresh Templates</button>
			</div>
			<input type="hidden" id="from-input" />
			<div class="form-row">
				<span class="form-label">Ancestor Folder ID <span style="color:var(--vscode-errorForeground)">*</span></span>
				<input class="inline-input mono" id="ancestor-input" value="0" placeholder="0" />
			</div>
			<div class="form-row">
				<span class="form-label">Query</span>
				<div class="typeahead-wrap">
					<input class="inline-input mono" id="query-input" placeholder="e.g. amount >= :minAmount AND status = :status" autocomplete="off" />
					<div class="typeahead-list" id="query-typeahead"></div>
				</div>
			</div>

			<div class="section-title">Query Parameters</div>
			<div class="dynamic-rows" id="params-rows"></div>
			<button class="add-btn" id="add-param-btn">+ Add Parameter</button>

			<div class="section-title">Order By</div>
			<div class="dynamic-rows" id="order-rows"></div>
			<button class="add-btn" id="add-order-btn">+ Add Order</button>

			<div class="section-title" style="margin-top:12px">Fields</div>
			<div class="dual-list">
				<div class="dual-list-panel">
					<label>Available</label>
					<select id="fields-available" multiple></select>
				</div>
				<div class="dual-list-actions">
					<button id="fields-add-btn" title="Add selected">&rsaquo;</button>
					<button id="fields-add-all-btn" title="Add all">&raquo;</button>
					<button id="fields-remove-btn" title="Remove selected">&lsaquo;</button>
					<button id="fields-remove-all-btn" title="Remove all">&laquo;</button>
				</div>
				<div class="dual-list-panel">
					<label>Selected</label>
					<select id="fields-selected" multiple></select>
				</div>
			</div>
			<input type="hidden" id="fields-input" />
			<div class="form-row">
				<span class="form-label">Limit</span>
				<input class="inline-input narrow" id="limit-input" type="number" min="0" max="100" placeholder="100" />
				<span class="hint">(0&ndash;100)</span>
			</div>

			<div id="status-msg" class="status-msg"></div>

			<div class="action-bar">
				<button class="primary-btn" id="execute-btn">Execute Query</button>
				<button class="secondary-btn" id="copy-btn">Copy Request JSON</button>
				<button class="primary-btn" id="next-btn" style="display:none">Next Page</button>
			</div>
		</div>
	</div>

	<div class="accordion" id="accordion-results" style="display:none">
		<button class="accordion-header" id="accordion-results-header">
			<span class="accordion-chevron">&#9660;</span> Results
		</button>
		<div class="accordion-body">
			<div class="tab-bar" id="tab-bar" style="display:flex">
				<button class="active" data-tab="http">HTTP</button>
				<button data-tab="ui-element">UI Element</button>
			</div>

			<div id="tab-http" class="tab-content active">
				<div class="results-header" id="results-header">Results <span class="count" id="results-count"></span><span class="results-filter"><input type="text" id="results-filter-input" placeholder="Filter by key or value..." /></span></div>
				<div class="results-block" id="results-block"></div>
			</div>

			<div id="tab-ui-element" class="tab-content">
				<div class="explorer-container" id="explorer-container">
					<div class="explorer-placeholder" id="explorer-placeholder">Execute a query to load the Content Explorer with metadata view.</div>
				</div>
			</div>
		</div>
	</div>

	<script nonce="${nonce}" src="${shimJs}"></script>
	<script nonce="${nonce}" src="${explorerJs}"></script>
	<script nonce="${nonce}">
	(function() {
		var vscode = window.__vscodeApi || acquireVsCodeApi();
		var statusEl = document.getElementById('status-msg');
		var paramsContainer = document.getElementById('params-rows');
		var orderContainer = document.getElementById('order-rows');
		var resultsHeader = document.getElementById('results-header');
		var resultsCount = document.getElementById('results-count');
		var resultsBlock = document.getElementById('results-block');
		var resultsFilterInput = document.getElementById('results-filter-input');
		var nextBtn = document.getElementById('next-btn');
		var lastResultData = null;
		var tabBar = document.getElementById('tab-bar');
		var templateDropdown = document.getElementById('template-dropdown');
		var fromInput = document.getElementById('from-input');
		var fieldsInput = document.getElementById('fields-input');
		var fieldsAvailable = document.getElementById('fields-available');
		var fieldsSelected = document.getElementById('fields-selected');
		var currentMarker = '';

		// Template data cache
		var cachedTemplates = [];
		var cachedEnterpriseId = '';

		// Explorer state
		var explorerInitialized = false;
		var lastAccessToken = '';
		var lastAncestorFolderId = '';
		var lastFrom = '';
		var lastFields = '';
		var lastQuery = '';
		var lastQueryParams = null;

		var params = [];
		var orders = [];

		function renderParams() {
			paramsContainer.innerHTML = params.map(function(p, i) {
				return '<div class="dynamic-row">' +
					'<input class="inline-input mono" data-arr="params" data-i="' + i + '" data-prop="key" value="' + esc(p.key) + '" placeholder="param name" />' +
					'<input class="inline-input mono" data-arr="params" data-i="' + i + '" data-prop="value" value="' + esc(p.value) + '" placeholder="value" />' +
					'<button class="remove-btn" data-arr="params" data-remove="' + i + '">&times;</button>' +
					'</div>';
			}).join('');
		}

		function renderOrders() {
			orderContainer.innerHTML = orders.map(function(o, i) {
				return '<div class="dynamic-row">' +
					'<input class="inline-input mono" data-arr="orders" data-i="' + i + '" data-prop="fieldKey" value="' + esc(o.fieldKey) + '" placeholder="field_key" />' +
					'<select class="inline-select" data-arr="orders" data-i="' + i + '" data-prop="direction">' +
					'<option value="ASC"' + (o.direction === 'ASC' ? ' selected' : '') + '>ASC</option>' +
					'<option value="DESC"' + (o.direction === 'DESC' ? ' selected' : '') + '>DESC</option>' +
					'</select>' +
					'<button class="remove-btn" data-arr="orders" data-remove="' + i + '">&times;</button>' +
					'</div>';
			}).join('');
		}

		document.addEventListener('input', function(e) {
			var t = e.target;
			var arr = t.getAttribute('data-arr');
			var idx = t.getAttribute('data-i');
			var prop = t.getAttribute('data-prop');
			if (!arr || idx === null || !prop) { return; }
			var list = arr === 'params' ? params : orders;
			list[parseInt(idx)][prop] = t.value;
		});

		document.addEventListener('change', function(e) {
			var t = e.target;
			// Handle order direction selects
			var arr = t.getAttribute('data-arr');
			var idx = t.getAttribute('data-i');
			var prop = t.getAttribute('data-prop');
			if (arr && idx !== null && prop) {
				var list = arr === 'params' ? params : orders;
				list[parseInt(idx)][prop] = t.value;
			}
		});

		// ─── Accordion toggle ───────────────────────────
		document.querySelectorAll('.accordion-header').forEach(function(header) {
			header.addEventListener('click', function() {
				header.parentElement.classList.toggle('collapsed');
			});
		});

		document.addEventListener('click', function(e) {
			var t = e.target;

			var rb = t.closest('[data-remove]');
			if (rb) {
				var arr = rb.getAttribute('data-arr');
				var idx = parseInt(rb.getAttribute('data-remove'));
				if (arr === 'params') { params.splice(idx, 1); renderParams(); }
				else { orders.splice(idx, 1); renderOrders(); }
				return;
			}

			if (t.closest('#add-param-btn')) {
				params.push({ key: '', value: '' });
				renderParams();
				return;
			}
			if (t.closest('#add-order-btn')) {
				orders.push({ fieldKey: '', direction: 'ASC' });
				renderOrders();
				return;
			}
			if (t.closest('#execute-btn')) { executeQuery(''); return; }
			if (t.closest('#next-btn')) { executeQuery(currentMarker); return; }
			if (t.closest('#copy-btn')) { copyRequestJson(); return; }
			if (t.closest('#fetch-templates-btn')) { fetchTemplates(); return; }

			// Tab switching
			var tabBtn = t.closest('[data-tab]');
			if (tabBtn && tabBar.contains(tabBtn)) {
				var tab = tabBtn.getAttribute('data-tab');
				tabBar.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
				tabBtn.classList.add('active');
				document.querySelectorAll('.tab-content').forEach(function(tc) { tc.classList.remove('active'); });
				document.getElementById('tab-' + tab).classList.add('active');

				// Lazy-init explorer when switching to UI Element tab
				if (tab === 'ui-element' && !explorerInitialized && lastAccessToken) {
					initExplorer();
				}
				return;
			}
		});

		// ─── Template fetching ──────────────────────────
		function fetchTemplates() {
			showStatus('Fetching enterprise templates...', 'info');
			vscode.postMessage({ type: 'fetchTemplates' });
		}

		templateDropdown.addEventListener('change', function() {
			var selectedKey = templateDropdown.value;
			if (!selectedKey) {
				fromInput.value = '';
				fieldsAvailable.innerHTML = '';
				fieldsSelected.innerHTML = '';
				syncFieldsInput();
				return;
			}
			var tmpl = cachedTemplates.find(function(t) { return t.templateKey === selectedKey; });
			if (!tmpl) { return; }

			var scope = 'enterprise_' + cachedEnterpriseId;
			fromInput.value = scope + '.' + tmpl.templateKey;

			// Populate available fields
			fieldsAvailable.innerHTML = '';
			fieldsSelected.innerHTML = '';
			if (tmpl.fields && tmpl.fields.length > 0) {
				tmpl.fields.forEach(function(f) {
					var opt = document.createElement('option');
					opt.value = scope + '.' + tmpl.templateKey + '.' + f.key;
					opt.textContent = f.displayName + ' (' + f.key + ')';
					fieldsAvailable.appendChild(opt);
				});
			}
			syncFieldsInput();
		});

		// ─── Dual-list field controls ───────────────────
		function moveOptions(fromEl, toEl) {
			var selected = Array.from(fromEl.selectedOptions);
			selected.forEach(function(opt) {
				fromEl.removeChild(opt);
				toEl.appendChild(opt);
			});
			syncFieldsInput();
		}

		function moveAllOptions(fromEl, toEl) {
			var opts = Array.from(fromEl.options);
			opts.forEach(function(opt) {
				fromEl.removeChild(opt);
				toEl.appendChild(opt);
			});
			syncFieldsInput();
		}

		function syncFieldsInput() {
			var vals = Array.from(fieldsSelected.options).map(function(o) { return o.value; });
			fieldsInput.value = vals.join(',');
		}

		document.getElementById('fields-add-btn').addEventListener('click', function() {
			moveOptions(fieldsAvailable, fieldsSelected);
		});
		document.getElementById('fields-add-all-btn').addEventListener('click', function() {
			moveAllOptions(fieldsAvailable, fieldsSelected);
		});
		document.getElementById('fields-remove-btn').addEventListener('click', function() {
			moveOptions(fieldsSelected, fieldsAvailable);
		});
		document.getElementById('fields-remove-all-btn').addEventListener('click', function() {
			moveAllOptions(fieldsSelected, fieldsAvailable);
		});

		// ─── Query typeahead ────────────────────────────
		var queryInput = document.getElementById('query-input');
		var typeaheadEl = document.getElementById('query-typeahead');
		var typeaheadActiveIdx = -1;

		function getTemplateFieldKeys() {
			var selectedKey = templateDropdown.value;
			if (!selectedKey) { return []; }
			var tmpl = cachedTemplates.find(function(t) { return t.templateKey === selectedKey; });
			if (!tmpl || !tmpl.fields) { return []; }
			return tmpl.fields;
		}

		function showTypeahead(filter) {
			var fields = getTemplateFieldKeys();
			if (fields.length === 0) { typeaheadEl.classList.remove('open'); return; }

			var lower = filter.toLowerCase();
			var matches = fields.filter(function(f) {
				return f.key.toLowerCase().indexOf(lower) !== -1 ||
					f.displayName.toLowerCase().indexOf(lower) !== -1;
			});

			if (matches.length === 0 || (matches.length === 1 && matches[0].key.toLowerCase() === lower)) {
				typeaheadEl.classList.remove('open');
				return;
			}

			typeaheadEl.innerHTML = matches.map(function(f, i) {
				return '<div class="typeahead-item" data-key="' + esc(f.key) + '">' +
					esc(f.key) + '<span class="field-type">' + esc(f.displayName) + ' (' + esc(f.type) + ')</span></div>';
			}).join('');
			typeaheadActiveIdx = -1;
			typeaheadEl.classList.add('open');
		}

		function closeTypeahead() {
			typeaheadEl.classList.remove('open');
			typeaheadActiveIdx = -1;
		}

		function getWordAtCursor() {
			var val = queryInput.value;
			var pos = queryInput.selectionStart;
			// Walk backwards to find word start
			var start = pos;
			while (start > 0 && /[a-zA-Z0-9_]/.test(val[start - 1])) { start--; }
			return { word: val.substring(start, pos), start: start, end: pos };
		}

		function insertFieldKey(key) {
			var info = getWordAtCursor();
			var val = queryInput.value;
			queryInput.value = val.substring(0, info.start) + key + val.substring(info.end);
			var newPos = info.start + key.length;
			queryInput.setSelectionRange(newPos, newPos);
			queryInput.focus();
			closeTypeahead();
			syncParamsFromQuery();
		}

		queryInput.addEventListener('input', function() {
			var info = getWordAtCursor();
			if (info.word.length > 0) {
				showTypeahead(info.word);
			} else {
				closeTypeahead();
			}
			syncParamsFromQuery();
		});

		queryInput.addEventListener('keydown', function(e) {
			if (!typeaheadEl.classList.contains('open')) { return; }
			var items = typeaheadEl.querySelectorAll('.typeahead-item');
			if (items.length === 0) { return; }

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				typeaheadActiveIdx = Math.min(typeaheadActiveIdx + 1, items.length - 1);
				items.forEach(function(el, i) { el.classList.toggle('active', i === typeaheadActiveIdx); });
				items[typeaheadActiveIdx].scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				typeaheadActiveIdx = Math.max(typeaheadActiveIdx - 1, 0);
				items.forEach(function(el, i) { el.classList.toggle('active', i === typeaheadActiveIdx); });
				items[typeaheadActiveIdx].scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'Enter' || e.key === 'Tab') {
				if (typeaheadActiveIdx >= 0 && typeaheadActiveIdx < items.length) {
					e.preventDefault();
					insertFieldKey(items[typeaheadActiveIdx].getAttribute('data-key'));
				}
			} else if (e.key === 'Escape') {
				closeTypeahead();
			}
		});

		queryInput.addEventListener('blur', function() {
			// Delay to allow click on typeahead item
			setTimeout(closeTypeahead, 150);
		});

		typeaheadEl.addEventListener('click', function(e) {
			var item = e.target.closest('.typeahead-item');
			if (item) { insertFieldKey(item.getAttribute('data-key')); }
		});

		// ─── Auto-populate query params from :merge fields ──
		function syncParamsFromQuery() {
			var val = queryInput.value;
			var regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
			var match;
			var foundKeys = [];
			while ((match = regex.exec(val)) !== null) {
				foundKeys.push(match[1]);
			}

			// Add missing params, preserve existing values
			var existingKeys = params.map(function(p) { return p.key; });
			var changed = false;

			// Add new params for merge fields not yet in the list
			foundKeys.forEach(function(key) {
				if (existingKeys.indexOf(key) === -1) {
					params.push({ key: key, value: '' });
					changed = true;
				}
			});

			// Remove params whose key no longer appears in the query
			for (var i = params.length - 1; i >= 0; i--) {
				if (params[i].key && foundKeys.indexOf(params[i].key) === -1 && !params[i].value) {
					params.splice(i, 1);
					changed = true;
				}
			}

			if (changed) { renderParams(); }
		}

		// ─── Query execution ────────────────────────────
		function getFromValue() {
			var selectedKey = templateDropdown.value;
			if (!selectedKey || !cachedEnterpriseId) { return fromInput.value.trim(); }
			return 'enterprise_' + cachedEnterpriseId + '.' + selectedKey;
		}

		function buildMessage(marker) {
			return {
				type: 'execute',
				from: getFromValue(),
				ancestorFolderId: document.getElementById('ancestor-input').value.trim(),
				query: document.getElementById('query-input').value.trim(),
				queryParams: params.filter(function(p) { return p.key.trim(); }),
				orderBy: orders.filter(function(o) { return o.fieldKey.trim(); }),
				fields: Array.from(fieldsSelected.options).map(function(o) { return o.value; }).join(','),
				limit: document.getElementById('limit-input').value.trim(),
				marker: marker || '',
			};
		}

		function executeQuery(marker) {
			var fromVal = getFromValue();
			if (!fromVal) { showStatus('"From" is required. Select a metadata template.', 'error'); return; }
			var ancestorVal = document.getElementById('ancestor-input').value.trim();
			if (!ancestorVal) { showStatus('"Ancestor Folder ID" is required.', 'error'); return; }
			showStatus('Executing query...', 'info');
			vscode.postMessage(buildMessage(marker));
		}

		function copyRequestJson() {
			var msg = buildMessage('');
			var body = {};
			body.from = msg.from;
			body.ancestor_folder_id = msg.ancestorFolderId;
			if (msg.query) { body.query = msg.query; }
			if (msg.queryParams.length > 0) {
				body.query_params = {};
				msg.queryParams.forEach(function(p) { body.query_params[p.key] = p.value; });
			}
			if (msg.orderBy.length > 0) {
				body.order_by = msg.orderBy.map(function(o) { return { field_key: o.fieldKey, direction: o.direction }; });
			}
			if (msg.fields) { body.fields = msg.fields.split(',').map(function(f) { return f.trim(); }).filter(Boolean); }
			if (msg.limit) { body.limit = parseInt(msg.limit, 10); }
			vscode.postMessage({ type: 'copyJson', text: JSON.stringify(body, null, 2) });
		}

		// ─── Content Explorer init ──────────────────────
		function initExplorer() {
			if (explorerInitialized || !lastAccessToken || !lastFrom) { return; }
			explorerInitialized = true;

			var placeholder = document.getElementById('explorer-placeholder');
			if (placeholder) { placeholder.style.display = 'none'; }

			// Build fields array in metadata.SCOPE.TEMPLATE_KEY.FIELD_KEY format
			var fieldsList = lastFields
				? lastFields.split(',').map(function(f) { return f.trim(); }).filter(Boolean)
				: [];

			// Build metadataQuery in Box API format (snake_case)
			var metadataQueryObj = {
				from: lastFrom,
				ancestor_folder_id: lastAncestorFolderId,
			};
			if (fieldsList.length > 0) {
				metadataQueryObj.fields = fieldsList;
			}
			if (lastQuery) {
				metadataQueryObj.query = lastQuery;
			}
			if (lastQueryParams) {
				metadataQueryObj.query_params = lastQueryParams;
			}

			// Build columns from the selected template fields
			var columns = [];
			var selectedTmplKey = templateDropdown.value;
			var selectedTmpl = cachedTemplates.find(function(t) { return t.templateKey === selectedTmplKey; });
			if (selectedTmpl && selectedTmpl.fields) {
				var scope = 'enterprise_' + cachedEnterpriseId;
				// Only include fields that are in the selected fields list
				selectedTmpl.fields.forEach(function(f) {
					var fullFieldId = 'metadata.' + scope + '.' + selectedTmpl.templateKey + '.' + f.key;
					// If no fields selected, include all; otherwise filter
					if (fieldsList.length === 0 || fieldsList.indexOf(fullFieldId) !== -1) {
						columns.push({
							textValue: f.displayName || f.key,
							id: fullFieldId,
							type: mapFieldType(f.type),
							allowsSorting: true,
							minWidth: 150,
							maxWidth: 220,
						});
					}
				});
			}

			var explorer = new Box.ContentExplorer();
			explorer.show(lastAncestorFolderId, lastAccessToken, {
				container: '#explorer-container',
				canPreview: true,
				canDownload: true,
				defaultView: 'metadata',
				metadataQuery: metadataQueryObj,
				features: {
					contentExplorer: {
						metadataViewV2: true,
					},
				},
				metadataViewProps: {
					columns: columns,
					isSelectionEnabled: true,

				},
			});
		}

		// Map Box metadata field types to Content Explorer column types
		function mapFieldType(type) {
			switch (type) {
				case 'float': return 'number';
				case 'enum': return 'singleSelect';
				case 'multiSelect': return 'multiSelect';
				case 'date': return 'date';
				default: return 'string';
			}
		}

		// ─── Utilities ──────────────────────────────────
		function showStatus(text, level) {
			statusEl.textContent = text;
			statusEl.className = 'status-msg ' + level;
		}

		function syntaxHighlight(json) {
			return json
				.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
				.replace(/"(\\\\u[a-fA-F0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?/g, function(match) {
					if (/:$/.test(match)) {
						return '<span style="color:#89b4fa">' + match.replace(/:$/, '') + '</span><span style="color:#6c7086">:</span>';
					}
					return '<span style="color:#a6e3a1">' + match + '</span>';
				})
				.replace(/\\b(true|false)\\b/g, '<span style="color:#fab387">$1</span>')
				.replace(/\\b(null)\\b/g, '<span style="color:#f38ba8">$1</span>')
				.replace(/\\b(-?\\d+\\.?\\d*([eE][+-]?\\d+)?)\\b/g, '<span style="color:#fab387">$1</span>');
		}

		// ─── Filter results ─────────────────────────────
		function filterJson(obj, term) {
			if (obj === null || obj === undefined) return null;
			if (Array.isArray(obj)) {
				var filtered = [];
				for (var i = 0; i < obj.length; i++) {
					var item = filterJson(obj[i], term);
					if (item !== null) filtered.push(item);
				}
				return filtered.length > 0 ? filtered : null;
			}
			if (typeof obj === 'object') {
				var result = {};
				var hasMatch = false;
				var keys = Object.keys(obj);
				for (var k = 0; k < keys.length; k++) {
					var key = keys[k];
					var val = obj[key];
					var keyMatch = key.toLowerCase().indexOf(term) !== -1;
					var valStr = (val === null || val === undefined) ? 'null' : String(val);
					var valMatch = typeof val !== 'object' && valStr.toLowerCase().indexOf(term) !== -1;
					if (keyMatch || valMatch) {
						result[key] = val;
						hasMatch = true;
					} else if (typeof val === 'object' && val !== null) {
						var nested = filterJson(val, term);
						if (nested !== null) {
							result[key] = nested;
							hasMatch = true;
						}
					}
				}
				// Always include id and type when the object has any match
				if (hasMatch) {
					if (obj.id !== undefined && result.id === undefined) result.id = obj.id;
					if (obj.type !== undefined && result.type === undefined) result.type = obj.type;
				}
				return hasMatch ? result : null;
			}
			var s = String(obj);
			return s.toLowerCase().indexOf(term) !== -1 ? obj : null;
		}

		resultsFilterInput.addEventListener('input', function() {
			if (!lastResultData) return;
			var term = resultsFilterInput.value.trim().toLowerCase();
			if (!term) {
				resultsBlock.innerHTML = syntaxHighlight(JSON.stringify(lastResultData, null, 2));
				var entries = (lastResultData && lastResultData.entries) || [];
				resultsCount.textContent = '(' + entries.length + ')';
				return;
			}
			var filtered = filterJson(lastResultData, term);
			if (filtered === null) filtered = {};
			var filteredEntries = (filtered && filtered.entries) || [];
			var totalEntries = (lastResultData && lastResultData.entries) || [];
			resultsCount.textContent = '(' + filteredEntries.length + ' / ' + totalEntries.length + ')';
			resultsBlock.innerHTML = syntaxHighlight(JSON.stringify(filtered, null, 2));
		});

		// ─── Message handler ────────────────────────────
		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'status') {
				showStatus(msg.text, msg.level);
			} else if (msg.type === 'templates') {
				statusEl.className = 'status-msg';
				statusEl.style.display = 'none';
				cachedTemplates = msg.templates || [];
				cachedEnterpriseId = msg.enterpriseId || '';

				// Populate dropdown
				var prevValue = templateDropdown.value;
				templateDropdown.innerHTML = '<option value="">-- Select a template (' + cachedTemplates.length + ') --</option>';
				cachedTemplates.forEach(function(t) {
					var opt = document.createElement('option');
					opt.value = t.templateKey;
					opt.textContent = t.displayName + ' (' + t.templateKey + ')';
					templateDropdown.appendChild(opt);
				});
				// Restore previous selection if still valid
				if (prevValue) {
					templateDropdown.value = prevValue;
				}
			} else if (msg.type === 'results') {
				statusEl.className = 'status-msg';
				statusEl.style.display = 'none';
				var entries = (msg.data && msg.data.entries) || [];

				// Show results accordion
				document.getElementById('accordion-results').style.display = '';
				document.getElementById('accordion-results').classList.remove('collapsed');

				// HTTP tab
				resultsHeader.style.display = 'flex';
				resultsCount.textContent = '(' + entries.length + ')';
				resultsBlock.style.display = 'block';
				lastResultData = msg.data;
				resultsFilterInput.value = '';
				resultsBlock.innerHTML = syntaxHighlight(JSON.stringify(msg.data, null, 2));
				currentMarker = msg.nextMarker || '';
				nextBtn.style.display = currentMarker ? 'inline-block' : 'none';

				// Store for UI Element tab
				if (msg.accessToken) {
					lastAccessToken = msg.accessToken;
					lastAncestorFolderId = msg.ancestorFolderId || '0';
					lastFrom = msg.from || '';
					lastFields = msg.fields || '';
					lastQuery = msg.query || '';
					lastQueryParams = msg.queryParams || null;
					// Reset explorer so it re-initializes with new token/folder
					explorerInitialized = false;
					document.getElementById('explorer-container').innerHTML =
						'<div class="explorer-placeholder" id="explorer-placeholder">Switch to UI Element tab to load the Content Explorer.</div>';

					// If UI Element tab is active, init immediately
					var activeTab = tabBar.querySelector('button.active');
					if (activeTab && activeTab.getAttribute('data-tab') === 'ui-element') {
						initExplorer();
					}
				}
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
