import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MetadataTaxonomy } from 'box-node-sdk/lib/schemas/metadataTaxonomy';
import { MetadataTaxonomyNode } from 'box-node-sdk/lib/schemas/metadataTaxonomyNode';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;
let currentTaxonomy: MetadataTaxonomy | undefined;
let currentNamespace: string | undefined;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function openMetadataTaxonomyNodeDetail(
	taxonomy: MetadataTaxonomy,
	namespace: string,
	focusNodeId: string,
): Promise<void> {
	return openMetadataTaxonomyDetail(taxonomy, namespace, focusNodeId);
}

export async function openMetadataTaxonomyDetail(taxonomy: MetadataTaxonomy, namespace: string, focusNodeId?: string): Promise<void> {
	currentTaxonomy = taxonomy;
	currentNamespace = namespace;
	const title = taxonomy.displayName ?? taxonomy.key ?? 'Metadata Taxonomy';

	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.One);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'boxMetadataTaxonomyDetail',
			title,
			vscode.ViewColumn.One,
			{ enableScripts: true },
		);
		currentPanel.onDidDispose(() => {
			currentPanel = undefined;
			currentTaxonomy = undefined;
			currentNamespace = undefined;
			messageListener?.dispose();
			messageListener = undefined;
		});
	}

	// Fetch nodes for this taxonomy
	const nodes = await fetchAllNodes(namespace, taxonomy.key ?? '');

	messageListener?.dispose();
	messageListener = currentPanel.webview.onDidReceiveMessage(async (msg) => {
		if (msg.type === 'copy') {
			await vscode.env.clipboard.writeText(msg.text);
			vscode.window.showInformationMessage(`Copied: ${msg.text}`);
		} else if (msg.type === 'saveJson') {
			if (currentTaxonomy) { await saveTaxonomyJson(currentTaxonomy, nodes); }
		} else if (msg.type === 'updateTaxonomy') {
			await handleUpdateTaxonomy(msg);
		} else if (msg.type === 'addLevel') {
			await handleAddLevel(msg);
		} else if (msg.type === 'updateLevel') {
			await handleUpdateLevel(msg);
		} else if (msg.type === 'deleteLevel') {
			await handleDeleteLevel();
		} else if (msg.type === 'addNode') {
			await handleAddNode(msg);
		} else if (msg.type === 'updateNode') {
			await handleUpdateNode(msg);
		} else if (msg.type === 'deleteNode') {
			await handleDeleteNode(msg);
		} else if (msg.type === 'deleteTaxonomy') {
			await handleDeleteTaxonomy();
		}
	});

	const nonce = crypto.randomBytes(16).toString('hex');
	currentPanel.webview.html = getWebviewHtml(taxonomy, nodes, nonce, focusNodeId);
}

// ─── Fetch all nodes ─────────────────────────────────────────────────────────

async function fetchAllNodes(namespace: string, taxonomyKey: string): Promise<MetadataTaxonomyNode[]> {
	const result = await getBoxClient();
	if (!result) { return []; }

	try {
		const allNodes: MetadataTaxonomyNode[] = [];
		let marker: string | undefined;

		do {
			const response = await result.client.metadataTaxonomies.getMetadataTaxonomyNodes(
				namespace, taxonomyKey,
				marker ? { queryParams: { marker } } : undefined,
			);
			const entries = response.entries ?? [];
			allNodes.push(...entries);
			marker = response.nextMarker ?? undefined;
		} while (marker);

		return allNodes;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to fetch nodes: ${message}`);
		return [];
	}
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleUpdateTaxonomy(msg: { displayName: string }): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		const updated = await result.client.metadataTaxonomies.updateMetadataTaxonomy(
			currentNamespace, currentTaxonomy.key ?? '', { displayName: msg.displayName },
		);
		currentTaxonomy = updated;
		postStatus('Taxonomy updated successfully!', 'success');
		vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to update taxonomy: ${message}`);
		postStatus(`Update failed: ${message}`, 'error');
	}
}

async function handleAddLevel(msg: { displayName: string; description: string }): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		const levels = await result.client.metadataTaxonomies.addMetadataTaxonomyLevel(
			currentNamespace, currentTaxonomy.key ?? '',
			{ displayName: msg.displayName, description: msg.description || undefined },
		);
		await refreshTaxonomyPanel(levels.entries ?? undefined);
		postStatus('Level added successfully!', 'success');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to add level: ${message}`);
		postStatus(`Add level failed: ${message}`, 'error');
	}
}

async function handleUpdateLevel(msg: { levelIndex: number; displayName: string; description: string }): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		await result.client.metadataTaxonomies.updateMetadataTaxonomyLevelById(
			currentNamespace, currentTaxonomy.key ?? '', msg.levelIndex,
			{ displayName: msg.displayName, description: msg.description || undefined },
		);
		await refreshTaxonomyPanel();
		postStatus('Level updated successfully!', 'success');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to update level: ${message}`);
		postStatus(`Update level failed: ${message}`, 'error');
	}
}

async function handleDeleteLevel(): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		const levels = await result.client.metadataTaxonomies.deleteMetadataTaxonomyLevel(
			currentNamespace, currentTaxonomy.key ?? '',
		);
		await refreshTaxonomyPanel(levels.entries ?? undefined);
		postStatus('Last level deleted.', 'success');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to delete level: ${message}`);
		postStatus(`Delete level failed: ${message}`, 'error');
	}
}

async function handleAddNode(msg: { displayName: string; level: number; parentId?: string }): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		await result.client.metadataTaxonomies.createMetadataTaxonomyNode(
			currentNamespace, currentTaxonomy.key ?? '',
			{ displayName: msg.displayName, level: msg.level, parentId: msg.parentId },
		);
		await refreshTaxonomyPanel();
		postStatus('Node added successfully!', 'success');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to add node: ${message}`);
		postStatus(`Add node failed: ${message}`, 'error');
	}
}

async function handleUpdateNode(msg: { nodeId: string; displayName: string }): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		await result.client.metadataTaxonomies.updateMetadataTaxonomyNode(
			currentNamespace, currentTaxonomy.key ?? '', msg.nodeId,
			{ requestBody: { displayName: msg.displayName } },
		);
		await refreshTaxonomyPanel();
		postStatus('Node updated successfully!', 'success');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to update node: ${message}`);
		postStatus(`Update node failed: ${message}`, 'error');
	}
}

async function handleDeleteNode(msg: { nodeId: string }): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }
	const result = await getBoxClient();
	if (!result) { postStatus('No Box connection available.', 'error'); return; }

	try {
		await result.client.metadataTaxonomies.deleteMetadataTaxonomyNode(
			currentNamespace, currentTaxonomy.key ?? '', msg.nodeId,
		);
		await refreshTaxonomyPanel();
		postStatus('Node deleted.', 'success');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Taxonomy] Failed to delete node: ${message}`);
		postStatus(`Delete node failed: ${message}`, 'error');
	}
}

// ─── Refresh panel ──────────────────────────────────────────────────────────

import { MetadataTaxonomyLevel } from 'box-node-sdk/lib/schemas/metadataTaxonomyLevel';

async function refreshTaxonomyPanel(updatedLevels?: readonly MetadataTaxonomyLevel[]): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }

	// Re-fetch taxonomy to get updated levels if not provided
	const result = await getBoxClient();
	if (!result) { return; }

	try {
		const updated = await result.client.metadataTaxonomies.getMetadataTaxonomyByKey(
			currentNamespace, currentTaxonomy.key ?? '',
		);
		currentTaxonomy = updated;
	} catch { /* use existing */ }

	if (updatedLevels) {
		currentTaxonomy = { ...currentTaxonomy, levels: updatedLevels };
	}

	const nodes = await fetchAllNodes(currentNamespace, currentTaxonomy.key ?? '');
	const data = taxonomyToWebviewData(currentTaxonomy, nodes);

	currentPanel?.webview.postMessage({
		type: 'taxonomyUpdated',
		taxonomy: data,
	});

	vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
}

function postStatus(text: string, level: 'info' | 'error' | 'success'): void {
	currentPanel?.webview.postMessage({ type: 'status', text, level });
	if (level === 'error') {
		vscode.window.showErrorMessage(text);
	}
}

// ─── Delete taxonomy via API ────────────────────────────────────────────────

async function handleDeleteTaxonomy(): Promise<void> {
	if (!currentTaxonomy || !currentNamespace) { return; }

	const taxonomyKey = currentTaxonomy.key ?? '';
	const displayName = currentTaxonomy.displayName ?? taxonomyKey;

	const confirm = await vscode.window.showWarningMessage(
		`Are you sure you want to delete the metadata taxonomy "${displayName}"? This will also delete all its levels and nodes. This action cannot be undone.`,
		{ modal: true },
		'Delete',
	);
	if (confirm !== 'Delete') { return; }

	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available.');
		return;
	}

	try {
		await result.client.metadataTaxonomies.deleteMetadataTaxonomy(currentNamespace, taxonomyKey);
		log(ext.out, `[Configuration] Deleted metadata taxonomy "${taxonomyKey}".`);
		vscode.window.showInformationMessage(`Metadata taxonomy "${displayName}" deleted.`);
		vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
		currentPanel?.dispose();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[Configuration] Failed to delete taxonomy "${taxonomyKey}": ${message}`);
		postStatus(`Delete failed: ${message}`, 'error');
	}
}

// ─── Save taxonomy JSON ─────────────────────────────────────────────────────

export async function saveTaxonomyJson(taxonomy: MetadataTaxonomy, nodes?: MetadataTaxonomyNode[]): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	const root = workspaceFolders[0].uri;
	const dirUri = vscode.Uri.joinPath(root, 'metadata-taxonomies');

	try { await vscode.workspace.fs.createDirectory(dirUri); } catch { /* exists */ }

	// If nodes not passed, fetch them
	if (!nodes && currentNamespace) {
		nodes = await fetchAllNodes(currentNamespace, taxonomy.key ?? '');
	}

	const json = buildTaxonomyJson(taxonomy, nodes ?? []);
	const fileName = `${taxonomy.key ?? 'taxonomy'}.json`;
	const fileUri = vscode.Uri.joinPath(dirUri, fileName);

	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(json, null, 2), 'utf-8'));
	log(ext.out, `[Configuration] Saved metadata taxonomy to ${fileUri.fsPath}`);
	vscode.window.showInformationMessage(`Saved: metadata-taxonomies/${fileName}`);

	const doc = await vscode.workspace.openTextDocument(fileUri);
	await vscode.window.showTextDocument(doc, { preview: false });
}

function buildTaxonomyJson(taxonomy: MetadataTaxonomy, nodes: MetadataTaxonomyNode[]): Record<string, unknown> {
	return {
		key: taxonomy.key ?? '',
		displayName: taxonomy.displayName ?? '',
		namespace: taxonomy.namespace ?? '',
		levels: (taxonomy.levels ?? []).map(l => ({
			level: l.level,
			displayName: l.displayName ?? '',
			description: l.description ?? '',
		})),
		nodes: nodes.map(n => ({
			id: n.id,
			displayName: n.displayName,
			level: n.level,
			parentId: n.parentId ?? null,
		})),
	};
}

// ─── Data conversion ─────────────────────────────────────────────────────────

interface WebviewNodeData {
	id: string;
	displayName: string;
	level: number;
	parentId: string | null;
	children: WebviewNodeData[];
}

interface WebviewTaxonomyData {
	displayName: string;
	key: string;
	namespace: string;
	levels: { level: number; displayName: string; description: string }[];
	nodes: WebviewNodeData[];
}

function taxonomyToWebviewData(taxonomy: MetadataTaxonomy, nodes: MetadataTaxonomyNode[]): WebviewTaxonomyData {
	// Build a tree structure from flat node list
	const nodeMap = new Map<string, WebviewNodeData>();
	const roots: WebviewNodeData[] = [];

	// First pass: create all node objects
	for (const n of nodes) {
		nodeMap.set(n.id, {
			id: n.id,
			displayName: n.displayName,
			level: n.level,
			parentId: n.parentId ?? null,
			children: [],
		});
	}

	// Second pass: build parent-child relationships
	for (const n of nodes) {
		const node = nodeMap.get(n.id)!;
		if (n.parentId && nodeMap.has(n.parentId)) {
			nodeMap.get(n.parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	// Sort children alphabetically at each level
	const sortChildren = (list: WebviewNodeData[]): void => {
		list.sort((a, b) => a.displayName.localeCompare(b.displayName));
		for (const n of list) { sortChildren(n.children); }
	};
	sortChildren(roots);

	return {
		displayName: taxonomy.displayName ?? '',
		key: taxonomy.key ?? '',
		namespace: taxonomy.namespace ?? '',
		levels: (taxonomy.levels ?? []).map(l => ({
			level: l.level ?? 0,
			displayName: l.displayName ?? '',
			description: l.description ?? '',
		})),
		nodes: roots,
	};
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function getWebviewHtml(taxonomy: MetadataTaxonomy, nodes: MetadataTaxonomyNode[], nonce: string, focusNodeId?: string): string {
	const taxonomyKey = taxonomy.key ?? '';
	const namespace = taxonomy.namespace ?? '';
	const data = taxonomyToWebviewData(taxonomy, nodes);
	const dataJson = JSON.stringify(data).replace(/<\//g, '<\\/');
	const focusNodeJson = focusNodeId ? JSON.stringify(focusNodeId) : 'null';

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

		.section-title { font-size: 1.1em; font-weight: 600; margin-top: 20px; margin-bottom: 4px; }
		.section-count { font-weight: 400; color: var(--vscode-descriptionForeground); }

		/* Levels table */
		table { width: 100%; border-collapse: collapse; margin-top: 8px; }
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

		.level-badge {
			display: inline-block; padding: 1px 8px; border-radius: 10px;
			font-size: 0.85em; font-weight: 500;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
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

		.add-bar { margin-top: 8px; display: flex; gap: 6px; align-items: center; }
		.add-bar input { max-width: 200px; }
		.add-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.4));
			border-radius: 3px; padding: 4px 12px; cursor: pointer;
			font-size: 0.9em;
		}
		.add-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

		/* Node tree */
		.node-tree { margin-top: 8px; }
		.node-row {
			display: flex; align-items: center; gap: 6px;
			padding: 4px 6px; border-radius: 3px;
		}
		.node-row:hover { background: var(--vscode-list-hoverBackground); }
		.node-indent { display: inline-block; }
		.node-name-input { max-width: 250px; }
		.node-add-row {
			display: flex; align-items: center; gap: 6px;
			padding: 4px 6px;
		}
		.node-add-input { max-width: 200px; }
		.node-toggle {
			background: none; border: none; cursor: pointer;
			color: var(--vscode-foreground); font-size: 0.9em;
			padding: 0 4px; opacity: 0.7;
		}
		.node-toggle:hover { opacity: 1; }
		.node-leaf-spacer { display: inline-block; width: 18px; }
		.node-row.focused {
			background: var(--vscode-list-activeSelectionBackground, rgba(0,120,215,0.3));
			outline: 1px solid var(--vscode-focusBorder, #007acc);
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>Metadata Taxonomy</h1>
		<div class="meta-row">
			<span class="meta-label">Display Name:</span>
			<input class="inline-input" id="taxonomy-name" style="max-width:300px" />
		</div>
		<div class="meta-row">
			<span class="meta-label">Namespace:</span>
			<span>${esc(namespace)}</span>
		</div>
		<div class="meta-row">
			<span class="meta-label">Taxonomy Key:</span>
			<button class="copy-btn" data-copy="${esc(taxonomyKey)}">${esc(taxonomyKey)} &#x2398;</button>
		</div>
		<div class="action-bar">
			<button class="primary-btn" id="update-btn">Update Taxonomy</button>
			<button class="secondary-btn" id="save-json-btn">Save JSON</button>
			<button class="danger-btn" id="delete-btn">Delete Taxonomy</button>
		</div>
	</div>

	<div id="status-msg" class="status-msg"></div>

	<div class="section-title">Levels <span class="section-count" id="level-count"></span></div>
	<table>
		<thead>
			<tr>
				<th>#</th>
				<th>Display Name</th>
				<th>Description</th>
				<th></th>
			</tr>
		</thead>
		<tbody id="levels-body"></tbody>
	</table>
	<div class="add-bar">
		<input class="inline-input" id="new-level-name" placeholder="Level name" />
		<input class="inline-input" id="new-level-desc" placeholder="Description (optional)" />
		<button class="add-btn" id="add-level-btn">+ Add Level</button>
		<button class="remove-btn" id="delete-last-level-btn" title="Delete last level">&times; Remove Last</button>
	</div>

	<div class="section-title">Nodes <span class="section-count" id="node-count"></span></div>
	<div class="node-tree" id="node-tree"></div>

	<script nonce="${nonce}">
	(function() {
		var vscode = acquireVsCodeApi();
		var DATA = ${dataJson};
		var FOCUS_NODE_ID = ${focusNodeJson};

		var displayName = DATA.displayName;
		var levels = DATA.levels;
		var nodes = DATA.nodes;

		var nameInput = document.getElementById('taxonomy-name');
		var levelsBody = document.getElementById('levels-body');
		var levelCount = document.getElementById('level-count');
		var nodeTree = document.getElementById('node-tree');
		var nodeCount = document.getElementById('node-count');
		var statusEl = document.getElementById('status-msg');

		// Track collapsed state by node id
		var collapsed = {};

		// If focusing on a specific node, collapse all top-level nodes except the path to the focus node
		if (FOCUS_NODE_ID) {
			collapseAllExceptPath(nodes, FOCUS_NODE_ID);
		}

		function collapseAllExceptPath(list, targetId) {
			// First collapse everything
			collapseAll(list);
			// Then expand the path to the target
			expandPathTo(list, targetId);
		}

		function collapseAll(list) {
			for (var i = 0; i < list.length; i++) {
				if (list[i].children.length > 0) {
					collapsed[list[i].id] = true;
				}
				collapseAll(list[i].children);
			}
		}

		function expandPathTo(list, targetId) {
			for (var i = 0; i < list.length; i++) {
				var n = list[i];
				if (n.id === targetId) {
					collapsed[n.id] = false;
					return true;
				}
				if (n.children.length > 0 && expandPathTo(n.children, targetId)) {
					collapsed[n.id] = false;
					return true;
				}
			}
			return false;
		}

		nameInput.value = displayName;
		renderLevels();
		renderNodes();

		// ── Levels ──
		function renderLevels() {
			levelCount.textContent = '(' + levels.length + ')';
			levelsBody.innerHTML = levels.map(function(l, i) {
				return '<tr>' +
					'<td><span class="level-badge">' + l.level + '</span></td>' +
					'<td><input class="inline-input" data-li="' + i + '" data-prop="displayName" value="' + esc(l.displayName) + '" /></td>' +
					'<td><input class="inline-input" data-li="' + i + '" data-prop="description" value="' + esc(l.description) + '" placeholder="description" /></td>' +
					'<td><button class="primary-btn" style="padding:2px 8px;font-size:0.85em" data-update-level="' + i + '">Save</button></td>' +
					'</tr>';
			}).join('');
		}

		// ── Nodes ──
		function renderNodes() {
			var totalCount = countNodes(nodes);
			nodeCount.textContent = '(' + totalCount + ')';
			nodeTree.innerHTML = renderNodeList(nodes, 0);
		}

		function countNodes(list) {
			var c = list.length;
			for (var i = 0; i < list.length; i++) {
				c += countNodes(list[i].children);
			}
			return c;
		}

		function renderNodeList(list, depth) {
			var html = '';
			for (var i = 0; i < list.length; i++) {
				var n = list[i];
				var indent = depth * 24;
				var hasChildren = n.children.length > 0;
				var isCollapsed = collapsed[n.id];
				var canHaveChildren = n.level < levels.length;

				var toggleBtn = hasChildren
					? '<button class="node-toggle" data-toggle="' + n.id + '">' + (isCollapsed ? '&#x25B6;' : '&#x25BC;') + '</button>'
					: '<span class="node-leaf-spacer"></span>';

				var focusClass = (FOCUS_NODE_ID && n.id === FOCUS_NODE_ID) ? ' focused' : '';
				html += '<div class="node-row' + focusClass + '" style="padding-left:' + indent + 'px" data-row-id="' + n.id + '">' +
					toggleBtn +
					'<span class="level-badge">' + n.level + '</span>' +
					'<input class="inline-input node-name-input" data-node-id="' + n.id + '" value="' + esc(n.displayName) + '" />' +
					'<button class="primary-btn" style="padding:2px 8px;font-size:0.85em" data-update-node="' + n.id + '">Save</button>' +
					'<button class="remove-btn" data-delete-node="' + n.id + '" title="Delete node">&times;</button>' +
					'</div>';

				if (hasChildren && !isCollapsed) {
					html += renderNodeList(n.children, depth + 1);
				}

				// Add child row (if this node can have children per levels)
				if (canHaveChildren && !isCollapsed) {
					var childLevel = n.level + 1;
					var childIndent = (depth + 1) * 24;
					var levelName = getLevelName(childLevel);
					var placeholder = 'Add ' + levelName + ' under ' + esc(n.displayName);
					html += '<div class="node-add-row" style="padding-left:' + childIndent + 'px">' +
						'<span class="node-leaf-spacer"></span>' +
						'<input class="inline-input node-add-input" data-add-parent="' + n.id + '" data-add-level="' + childLevel + '" placeholder="' + placeholder + '" />' +
						'<button class="add-btn" data-add-node-parent="' + n.id + '" data-add-node-level="' + childLevel + '">+ Add ' + esc(levelName) + '</button>' +
						'</div>';
				}
			}
			return html;
		}

		function getLevelName(levelNum) {
			for (var i = 0; i < levels.length; i++) {
				if (levels[i].level === levelNum) return levels[i].displayName;
			}
			return 'Level ' + levelNum;
		}

		// ── Root add node ──
		function renderRootAddNode() {
			if (levels.length === 0) return '';
			var rootLevelName = getLevelName(1);
			return '<div class="node-add-row">' +
				'<span class="node-leaf-spacer"></span>' +
				'<input class="inline-input node-add-input" id="root-node-input" placeholder="Add new ' + esc(rootLevelName) + '" />' +
				'<button class="add-btn" id="add-root-node-btn">+ Add ' + esc(rootLevelName) + '</button>' +
				'</div>';
		}

		function fullRenderNodes() {
			var totalCount = countNodes(nodes);
			nodeCount.textContent = '(' + totalCount + ')';
			nodeTree.innerHTML = renderNodeList(nodes, 0) + renderRootAddNode();
		}
		fullRenderNodes();

		// Scroll to focused node
		if (FOCUS_NODE_ID) {
			var focusEl = document.querySelector('[data-row-id="' + FOCUS_NODE_ID + '"]');
			if (focusEl) { focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
		}

		// ── Events ──
		nameInput.addEventListener('input', function() { displayName = nameInput.value; });

		document.addEventListener('input', function(e) {
			var t = e.target;
			var li = t.getAttribute('data-li');
			var prop = t.getAttribute('data-prop');
			if (li !== null && prop) {
				levels[parseInt(li)][prop] = t.value;
			}
		});

		document.addEventListener('click', function(e) {
			var t = e.target;

			// Copy
			var cb = t.closest('[data-copy]');
			if (cb) { vscode.postMessage({ type: 'copy', text: cb.getAttribute('data-copy') }); return; }

			// Toggle node
			var tog = t.closest('[data-toggle]');
			if (tog) {
				var nid = tog.getAttribute('data-toggle');
				collapsed[nid] = !collapsed[nid];
				fullRenderNodes();
				return;
			}

			// Update taxonomy name
			if (t.closest('#update-btn')) {
				vscode.postMessage({ type: 'updateTaxonomy', displayName: displayName });
				showStatus('Updating...', 'info');
				return;
			}

			// Save JSON
			if (t.closest('#save-json-btn')) {
				vscode.postMessage({ type: 'saveJson' });
				return;
			}

			// Delete taxonomy
			if (t.closest('#delete-btn')) {
				vscode.postMessage({ type: 'deleteTaxonomy' });
				return;
			}

			// Add level
			if (t.closest('#add-level-btn')) {
				var nameEl = document.getElementById('new-level-name');
				var descEl = document.getElementById('new-level-desc');
				var name = nameEl.value.trim();
				if (!name) { showStatus('Level name is required.', 'error'); return; }
				vscode.postMessage({ type: 'addLevel', displayName: name, description: descEl.value.trim() });
				nameEl.value = '';
				descEl.value = '';
				showStatus('Adding level...', 'info');
				return;
			}

			// Delete last level
			if (t.closest('#delete-last-level-btn')) {
				if (levels.length === 0) { showStatus('No levels to delete.', 'error'); return; }
				vscode.postMessage({ type: 'deleteLevel' });
				showStatus('Deleting last level...', 'info');
				return;
			}

			// Update level
			var ulBtn = t.closest('[data-update-level]');
			if (ulBtn) {
				var idx = parseInt(ulBtn.getAttribute('data-update-level'));
				var lv = levels[idx];
				vscode.postMessage({
					type: 'updateLevel',
					levelIndex: lv.level,
					displayName: lv.displayName,
					description: lv.description
				});
				showStatus('Updating level...', 'info');
				return;
			}

			// Update node
			var unBtn = t.closest('[data-update-node]');
			if (unBtn) {
				var nodeId = unBtn.getAttribute('data-update-node');
				var inp = document.querySelector('[data-node-id="' + nodeId + '"]');
				if (inp) {
					vscode.postMessage({ type: 'updateNode', nodeId: nodeId, displayName: inp.value });
					showStatus('Updating node...', 'info');
				}
				return;
			}

			// Delete node
			var dnBtn = t.closest('[data-delete-node]');
			if (dnBtn) {
				var nodeId = dnBtn.getAttribute('data-delete-node');
				vscode.postMessage({ type: 'deleteNode', nodeId: nodeId });
				showStatus('Deleting node...', 'info');
				return;
			}

			// Add child node
			var anBtn = t.closest('[data-add-node-parent]');
			if (anBtn) {
				var parentId = anBtn.getAttribute('data-add-node-parent');
				var level = parseInt(anBtn.getAttribute('data-add-node-level'));
				var inp = document.querySelector('[data-add-parent="' + parentId + '"]');
				var name = inp ? inp.value.trim() : '';
				if (!name) { showStatus('Node name is required.', 'error'); return; }
				vscode.postMessage({ type: 'addNode', displayName: name, level: level, parentId: parentId });
				if (inp) inp.value = '';
				showStatus('Adding node...', 'info');
				return;
			}

			// Add root node
			if (t.closest('#add-root-node-btn')) {
				var inp = document.getElementById('root-node-input');
				var name = inp ? inp.value.trim() : '';
				if (!name) { showStatus('Node name is required.', 'error'); return; }
				vscode.postMessage({ type: 'addNode', displayName: name, level: 1 });
				if (inp) inp.value = '';
				showStatus('Adding root node...', 'info');
				return;
			}
		});

		// ── Status ──
		function showStatus(text, level) {
			statusEl.textContent = text;
			statusEl.className = 'status-msg ' + level;
		}

		// ── Messages from extension ──
		window.addEventListener('message', function(e) {
			var msg = e.data;
			if (msg.type === 'taxonomyUpdated') {
				var t = msg.taxonomy;
				displayName = t.displayName;
				nameInput.value = displayName;
				levels = t.levels;
				nodes = t.nodes;
				renderLevels();
				fullRenderNodes();
				showStatus('Updated successfully!', 'success');
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
