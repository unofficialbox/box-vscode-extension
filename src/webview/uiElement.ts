import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BoxOAuth } from 'box-node-sdk';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';

type UIElementType = 'contentUploader' | 'contentPicker' | 'contentPreview' | 'contentExplorer' | 'metadataQueryBuilder';

const activePanels = new Set<vscode.WebviewPanel>();

// ─── Public API ──────────────────────────────────────────────────────────────

export async function openUIElement(elementType: UIElementType, prefilledId?: string): Promise<void> {
	let id = prefilledId;

	if (!id) {
		// Determine what input we need
		const needsFileId = elementType === 'contentPreview';
		const prompt = needsFileId ? 'Enter Box File ID' : 'Enter Box Folder ID (use 0 for root)';
		const placeholder = needsFileId ? 'e.g. 123456789' : 'e.g. 0';

		id = await vscode.window.showInputBox({
			prompt,
			placeHolder: placeholder,
			validateInput: (v) => /^\d+$/.test(v.trim()) ? null : 'Must be a numeric ID',
		});
		if (!id) { return; }
	}

	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
		return;
	}

	// Downscope token with appropriate scopes
	let accessToken: string;
	try {
		accessToken = await downscopeToken(id.trim(), result.auth, elementType);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[UIElements] Token downscope failed: ${message}`);
		vscode.window.showErrorMessage(`Failed to downscope token: ${message}`);
		return;
	}

	const title = getTitle(elementType, id.trim());
	const extensionUri = ext.context.extensionUri;
	const elementsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-ui-elements', 'dist');
	const annotationsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-annotations', 'dist');
	const resourcesDir = vscode.Uri.joinPath(extensionUri, 'resources');

	const panel = createPanel(title, [elementsDir, annotationsDir, resourcesDir]);
	setupApiProxy(panel);

	const nonce = crypto.randomBytes(16).toString('hex');
	panel.webview.html = getWebviewHtml(elementType, id.trim(), accessToken, nonce, panel.webview, extensionUri);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTitle(type: UIElementType, id: string): string {
	switch (type) {
		case 'contentUploader': return `Content Uploader — ${id}`;
		case 'contentPicker': return `Content Picker — ${id}`;
		case 'contentPreview': return `Content Preview — ${id}`;
		case 'contentExplorer': return `Content Explorer — ${id}`;
		case 'metadataQueryBuilder': return `Metadata Query Builder`;
	}
}

async function downscopeToken(id: string, auth: BoxOAuth, type: UIElementType): Promise<string> {
	const isFile = type === 'contentPreview';
	const resourceType = isFile ? 'files' : 'folders';
	const resource = `https://api.box.com/2.0/${resourceType}/${id}`;

	const scopes = getScopesForElement(type);
	const downscopedToken = await auth.downscopeToken(scopes, resource);
	const accessToken = downscopedToken.accessToken ?? '';
	if (!accessToken) {
		throw new Error('Downscoped token returned empty access token');
	}
	log(ext.out, `[UIElements] Token downscoped for ${type} (${resourceType}/${id}).`);
	return accessToken;
}

function getScopesForElement(type: UIElementType): string[] {
	switch (type) {
		case 'contentUploader':
			return ['base_upload', 'root_readwrite'];
		case 'contentPicker':
			return ['base_picker', 'item_share', 'item_upload', 'root_readwrite'];
		case 'contentPreview':
			return ['base_preview', 'item_download', 'root_readwrite', 'annotation_edit', 'annotation_view_all', 'ai.readwrite'];
		case 'contentExplorer':
			return ['base_explorer', 'item_preview', 'item_download', 'item_rename', 'item_delete', 'item_share', 'item_upload', 'root_readwrite'];
		case 'metadataQueryBuilder':
			return [];
	}
}

// ─── Panel management ───────────────────────────────────────────────────────

function createPanel(title: string, localResourceRoots: vscode.Uri[]): vscode.WebviewPanel {
	const panel = vscode.window.createWebviewPanel(
		'boxUIElement',
		title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots,
		},
	);

	activePanels.add(panel);
	panel.onDidDispose(() => {
		activePanels.delete(panel);
	});

	return panel;
}

// ─── API proxy (extension-side) ─────────────────────────────────────────────

function setupApiProxy(panel: vscode.WebviewPanel): void {
	const webview = panel.webview;
	const listener = webview.onDidReceiveMessage(async (msg) => {
		if (msg.type === 'copy') {
			await vscode.env.clipboard.writeText(msg.text);
			vscode.window.showInformationMessage(`Copied: ${msg.text}`);
			return;
		}
		if (msg.type !== 'api-proxy') { return; }

		// Detect folder navigation: GET /2.0/folders/{id}
		if (msg.method === 'GET') {
			const folderMatch = msg.url?.match(/api\.box\.com\/2\.0\/folders\/(\d+)/);
			if (folderMatch) {
				webview.postMessage({
					type: 'folder-navigated',
					folderId: folderMatch[1],
				});
			}
		}

		try {
			// Reconstruct FormData from serialized entries when present
			let fetchBody: any;
			let fetchHeaders = { ...msg.headers };

			if (msg.formData && Array.isArray(msg.formData)) {
				const formData = new FormData();
				for (const entry of msg.formData) {
					if (entry.base64) {
						const buf = Buffer.from(entry.base64, 'base64');
						const blob = new Blob([buf], { type: entry.type || 'application/octet-stream' });
						formData.append(entry.name, blob, entry.fileName || 'blob');
					} else {
						formData.append(entry.name, entry.value ?? '');
					}
				}
				fetchBody = formData;
				// Remove content-type so fetch auto-generates the multipart boundary
				delete fetchHeaders['content-type'];
				delete fetchHeaders['Content-Type'];
			} else {
				fetchBody = msg.body || undefined;
			}

			const resp = await fetch(msg.url, {
				method: msg.method,
				headers: fetchHeaders,
				body: fetchBody,
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

			webview.postMessage({
				type: 'api-proxy-response',
				id: msg.id,
				status: resp.status,
				statusText: resp.statusText,
				headers: responseHeaders,
				body: responseBody,
				isBinary,
			});
		} catch (err) {
			webview.postMessage({
				type: 'api-proxy-response',
				id: msg.id,
				status: 0,
				statusText: String(err),
				headers: {},
				body: '',
				isBinary: false,
			});
		}
	});

	panel.onDidDispose(() => {
		listener.dispose();
	});
}

// ─── Webview HTML ───────────────────────────────────────────────────────────

function getWebviewHtml(
	type: UIElementType,
	id: string,
	accessToken: string,
	nonce: string,
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
): string {
	const elementsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-ui-elements', 'dist');
	const annotationsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-annotations', 'dist');
	const resourcesDir = vscode.Uri.joinPath(extensionUri, 'resources');
	const shimJs = webview.asWebviewUri(vscode.Uri.joinPath(resourcesDir, 'apiProxyShim.js'));
	const cspSource = webview.cspSource;

	const { jsFile, cssFile, initScript, extraCssLinks, extraJsScripts } = getElementAssets(type, id, accessToken, nonce, webview, elementsDir, annotationsDir, resourcesDir);

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
	<link rel="stylesheet" href="${cssFile}">
	${extraCssLinks}
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; overflow: hidden; }
		.toolbar {
			display: flex; align-items: center; gap: 12px;
			padding: 10px 16px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
			font-family: var(--vscode-font-family, sans-serif);
			font-size: 13px;
			color: var(--vscode-foreground);
		}
		.toolbar-label {
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
			font-size: 13px;
		}
		.copy-btn {
			display: inline-flex; align-items: center; gap: 6px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none; border-radius: 4px; padding: 4px 12px;
			font-size: 13px; cursor: pointer;
			font-family: var(--vscode-editor-font-family, monospace);
			transition: background 0.15s;
		}
		.copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.copy-btn.copied {
			background: var(--vscode-terminal-ansiGreen, #1b5e20);
			color: #fff;
		}
		.container { width: 100%; height: calc(100vh - 41px); }
	</style>
</head>
<body>
	<div class="toolbar">
		<span class="toolbar-label" id="toolbar-label">${type === 'contentPreview' ? 'File ID:' : 'Folder ID:'}</span>
		<button class="copy-btn" id="copy-id-btn">${id} &#x2398;</button>
	</div>
	<div class="container"></div>
	<script nonce="${nonce}" src="${shimJs}"></script>
	<script nonce="${nonce}" src="${jsFile}"></script>
	${extraJsScripts}
	<script nonce="${nonce}">
		var vscode = window.__vscodeApi;
		var _toolbarCurrentId = '${id}';
		var _toolbarLabel = document.getElementById('toolbar-label');
		var _toolbarBtn = document.getElementById('copy-id-btn');
		var _copyTimeout;

		function updateToolbarId(newId, labelText) {
			_toolbarCurrentId = String(newId);
			_toolbarBtn.textContent = _toolbarCurrentId;
			_toolbarBtn.insertAdjacentHTML('beforeend', ' &#x2398;');
			if (_toolbarBtn.classList.contains('copied')) {
				_toolbarBtn.classList.remove('copied');
				clearTimeout(_copyTimeout);
			}
			if (labelText) { _toolbarLabel.textContent = labelText; }
		}

		window.addEventListener('message', function(event) {
			var msg = event.data;
			if (msg.type === 'folder-navigated' && msg.folderId) {
				updateToolbarId(msg.folderId, 'Folder ID:');
			}
		});

		_toolbarBtn.addEventListener('click', function() {
			vscode.postMessage({ type: 'copy', text: _toolbarCurrentId });
			_toolbarBtn.innerHTML = '&#x2713; Copied!';
			_toolbarBtn.classList.add('copied');
			_copyTimeout = setTimeout(function() {
				_toolbarBtn.textContent = _toolbarCurrentId;
				_toolbarBtn.insertAdjacentHTML('beforeend', ' &#x2398;');
				_toolbarBtn.classList.remove('copied');
			}, 1500);
		});

		${initScript}
	</script>
</body>
</html>`;
}

interface ElementAssets {
	jsFile: vscode.Uri;
	cssFile: vscode.Uri;
	initScript: string;
	extraCssLinks: string;
	extraJsScripts: string;
}

function getElementAssets(
	type: UIElementType,
	id: string,
	accessToken: string,
	nonce: string,
	webview: vscode.Webview,
	elementsDir: vscode.Uri,
	annotationsDir: vscode.Uri,
	resourcesDir: vscode.Uri,
): ElementAssets {
	const logoUrl = webview.asWebviewUri(vscode.Uri.joinPath(resourcesDir, 'boxAppIcon.png'));
	switch (type) {
		case 'contentUploader': {
			return {
				jsFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'uploader.js')),
				cssFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'uploader.css')),
				extraCssLinks: '',
				extraJsScripts: '',
				initScript: `
					var uploader = new Box.ContentUploader();
					uploader.show('${id}', '${accessToken}', {
						container: '.container',
					});
					uploader.addListener('upload', function(file) {
						if (file && file.id) { updateToolbarId(file.id, 'File ID:'); }
					});
					uploader.addListener('complete', function(files) {
						if (files && files.length === 1 && files[0].id) { updateToolbarId(files[0].id, 'File ID:'); }
					});
				`,
			};
		}
		case 'contentPicker': {
			return {
				jsFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'picker.js')),
				cssFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'picker.css')),
				extraCssLinks: '',
				extraJsScripts: '',
				initScript: `
					var picker = new Box.ContentPicker();
					picker.show('${id}', '${accessToken}', {
						container: '.container',
						maxSelectable: Infinity,
						canSetShareAccess: false,
						logoUrl: '${logoUrl}',
					});
					picker.addListener('choose', function(items) {
						if (items && items.length === 1 && items[0].id) {
							var item = items[0];
							var label = item.type === 'file' ? 'File ID:' : 'Folder ID:';
							updateToolbarId(item.id, label);
						}
					});
				`,
			};
		}
		case 'contentPreview': {
			const annotationsJs = webview.asWebviewUri(vscode.Uri.joinPath(annotationsDir, 'annotations.js'));
			const annotationsCss = webview.asWebviewUri(vscode.Uri.joinPath(annotationsDir, 'annotations.css'));
			const sidebarCss = webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'sidebar.css'));
			return {
				jsFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'preview.js')),
				cssFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'preview.css')),
				extraCssLinks: `<link rel="stylesheet" href="${sidebarCss}">\n\t<link rel="stylesheet" href="${annotationsCss}">`,
				extraJsScripts: `<script nonce="${nonce}" src="${annotationsJs}"></script>`,
				initScript: `
					var boxAnnotations = new BoxAnnotations();
					var preview = new Box.ContentPreview();
					preview.show('${id}', '${accessToken}', {
						container: '.container',
						boxAnnotations: boxAnnotations,
						showDownload: true,
						hasHeader: true,
						showAnnotations: true,
						enableAnnotationsDiscoverability: true,
						enableAnnotationsImageDiscoverability: true,
						showAnnotationsControls: true,
						showAnnotationsDrawingCreate: true,
						contentSidebarProps: {
							detailsSidebarProps: {
								hasAccessStats: true,
								hasClassification: true,
								hasNotices: true,
								hasProperties: true,
								hasRetentionPolicy: true,
								hasVersions: true,
							},
							hasActivityFeed: true,
							hasMetadata: true,
							hasSkills: true,
							hasVersions: true,
							features: {
								activityFeed: {
									annotations: { enabled: true },
								},
							}
						},
						contentAnswersProps: {
							show: true,
							isCitationsEnabled: true,
							isMarkdownEnabled: true,
							isResetChatEnabled: true,
						},
					});
					preview.addListener('navigate', function(fileId) {
						if (fileId) { updateToolbarId(fileId, 'File ID:'); }
					});
					preview.addListener('load', function(data) {
						if (data && data.file && data.file.id) { updateToolbarId(data.file.id, 'File ID:'); }
					});
				`,
			};
		}
		case 'contentExplorer': {
			return {
				jsFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'explorer.js')),
				cssFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'explorer.css')),
				extraCssLinks: '',
				extraJsScripts: '',
				initScript: `
					var explorer = new Box.ContentExplorer();
					explorer.show('${id}', '${accessToken}', {
						container: '.container',
						canPreview: true,
						canDownload: true,
						canDelete: true,
						canRename: true,
						canUpload: true,
						canShare: true,
						canCreateNewFolder: true,
						logoUrl: '${logoUrl}',
					});
					explorer.addListener('navigate', function(folder) {
						if (folder && folder.id) { updateToolbarId(folder.id, 'Folder ID:'); }
					});
					explorer.addListener('select', function(items) {
						if (items && items.length === 1 && items[0].id) {
							var item = items[0];
							var label = item.type === 'file' ? 'File ID:' : 'Folder ID:';
							updateToolbarId(item.id, label);
						}
					});
				`,
			};
		}
		case 'metadataQueryBuilder': {
			// Not used — metadataQueryBuilder has its own webview
			return {
				jsFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'explorer.js')),
				cssFile: webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'explorer.css')),
				extraCssLinks: '',
				extraJsScripts: '',
				initScript: '',
			};
		}
	}
}
