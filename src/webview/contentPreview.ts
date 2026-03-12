import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BoxOAuth } from 'box-node-sdk';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function openContentPreview(fileId: string, fileName: string): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
		return;
	}

	// 1. Downscope token
	let accessToken: string;
	try {
		accessToken = await downscopePreviewToken(fileId, result.auth);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[ContentPreview] Token downscope failed: ${message}`);
		vscode.window.showErrorMessage(`Failed to downscope token: ${message}`);
		return;
	}

	// 2. Resolve local resource directories
	const extensionUri = ext.context.extensionUri;
	const elementsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-ui-elements', 'dist');
	const annotationsDir = vscode.Uri.joinPath(extensionUri, 'node_modules', 'box-annotations', 'dist');

	const resourcesDir = vscode.Uri.joinPath(extensionUri, 'resources');

	// 3. Get or create webview panel
	const panel = getOrCreatePanel(fileName, [elementsDir, annotationsDir, resourcesDir]);

	// 4. Set up API proxy (XHR + fetch)
	setupApiProxy(panel.webview);

	// 5. Build and assign HTML
	const shimJs = panel.webview.asWebviewUri(vscode.Uri.joinPath(resourcesDir, 'apiProxyShim.js'));
	const previewJs = panel.webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'preview.js'));
	const previewCss = panel.webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'preview.css'));
	const sidebarCss = panel.webview.asWebviewUri(vscode.Uri.joinPath(elementsDir, 'sidebar.css'));
	const annotationsJs = panel.webview.asWebviewUri(vscode.Uri.joinPath(annotationsDir, 'annotations.js'));
	const annotationsCss = panel.webview.asWebviewUri(vscode.Uri.joinPath(annotationsDir, 'annotations.css'));
	const nonce = crypto.randomBytes(16).toString('hex');

	panel.webview.html = getWebviewHtml(
		fileId, accessToken, nonce, shimJs, previewJs, previewCss, sidebarCss, annotationsJs, annotationsCss, panel.webview.cspSource
	);
}

// ─── Token downscoping ──────────────────────────────────────────────────────

async function downscopePreviewToken(fileId: string, auth: BoxOAuth): Promise<string> {
	const resource = `https://api.box.com/2.0/files/${fileId}`;

	// Try with full scopes (including Box AI) first, then fall back without AI
	// if the OAuth app doesn't have that scope enabled.
	const fullScopes = [
		'base_preview', 'item_download', 'root_readwrite',
		'annotation_edit', 'annotation_view_all',
		// 'ai.readwrite',
	];
	const baseScopes = [
		'base_preview', 'item_download', 'root_readwrite',
		'annotation_edit', 'annotation_view_all',
	];

	let downscopedToken;
	try {
		downscopedToken = await auth.downscopeToken(fullScopes, resource);
	} catch {
		log(ext.out, `[ContentPreview] Full-scope downscope failed (ai.readwrite may not be enabled). Retrying without AI scope.`);
		downscopedToken = await auth.downscopeToken(baseScopes, resource);
	}

	const accessToken = downscopedToken.accessToken ?? '';
	if (!accessToken) {
		throw new Error('Downscoped token returned empty access token');
	}
	log(ext.out, `[ContentPreview] Token downscoped for file ${fileId}.`);
	return accessToken;
}

// ─── Panel management ───────────────────────────────────────────────────────

function getOrCreatePanel(fileName: string, localResourceRoots: vscode.Uri[]): vscode.WebviewPanel {
	if (currentPanel) {
		currentPanel.title = fileName;
		currentPanel.reveal(vscode.ViewColumn.One);
		return currentPanel;
	}

	currentPanel = vscode.window.createWebviewPanel(
		'boxContentPreview',
		fileName,
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots,
		},
	);

	currentPanel.onDidDispose(() => {
		currentPanel = undefined;
		messageListener?.dispose();
		messageListener = undefined;
	});

	return currentPanel;
}

// ─── API proxy (extension-side) ─────────────────────────────────────────────

function setupApiProxy(webview: vscode.Webview): void {
	messageListener?.dispose();
	messageListener = webview.onDidReceiveMessage(async (msg) => {
		if (msg.type !== 'api-proxy') { return; }
		try {
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

			currentPanel?.webview.postMessage({
				type: 'api-proxy-response',
				id: msg.id,
				status: resp.status,
				statusText: resp.statusText,
				headers: responseHeaders,
				body: responseBody,
				isBinary,
			});
		} catch (err) {
			currentPanel?.webview.postMessage({
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
}

// ─── Webview HTML ───────────────────────────────────────────────────────────

function getWebviewHtml(
	fileId: string,
	accessToken: string,
	nonce: string,
	shimJs: vscode.Uri,
	previewJs: vscode.Uri,
	previewCss: vscode.Uri,
	sidebarCss: vscode.Uri,
	annotationsJs: vscode.Uri,
	annottationsCss: vscode.Uri,
	cspSource: string

): string {
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
	<link rel="stylesheet" href="${previewCss}">
	<link rel="stylesheet" href="${sidebarCss}">
	<link rel="stylesheet" href="${annottationsCss}">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; overflow: hidden; }
		.preview-container { width: 100%; height: 100vh; }
	</style>
</head>
<body>
	<div class="preview-container"></div>
	<script nonce="${nonce}" src="${shimJs}"></script>
	<script nonce="${nonce}" src="${previewJs}"></script>
	<script nonce="${nonce}" src="${annotationsJs}"></script>
	<script nonce="${nonce}">
		var boxAnnotations = new BoxAnnotations();

		var preview = new Box.ContentPreview();
		preview.show('${fileId}', '${accessToken}', {
			container: '.preview-container',
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
						annotations: {
							enabled: true,
						},
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
	</script>
</body>
</html>`;
}
