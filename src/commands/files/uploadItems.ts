import { Readable } from 'stream';
import * as vscode from 'vscode';
import { BoxClient } from 'box-node-sdk';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getBoxClient, getBoxClientForAlias, BoxClientResult } from '../../utils/boxClient';
import { getConnectionAliases, getConnection } from '../../utils/connectionStorage';
import { openUploadDiffPreview, UploadDiffItem } from '../../webview/uploadDiffPreview';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LocalEntry {
	name: string;
	type: 'file' | 'folder';
	uri: vscode.Uri;
	children?: LocalEntry[];
}

interface RemoteEntry {
	id: string;
	name: string;
	type: string;
	sha1?: string;
	size?: number;
	createdBy?: string;
	createdAt?: string;
}

// ─── Public commands ─────────────────────────────────────────────────────────

export async function uploadFoldersToDefault(): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
		return;
	}

	const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
	await buildAndShowUploadDiff(result, alias);
}

export async function uploadFoldersToTarget(): Promise<void> {
	const aliases = await getConnectionAliases();
	if (aliases.length === 0) {
		vscode.window.showErrorMessage('No Box connections available. Please authorize a connection first.');
		return;
	}

	const items: vscode.QuickPickItem[] = [];
	for (const alias of aliases) {
		const conn = await getConnection(alias);
		const detail = conn
			? `${conn.userLogin} — Enterprise ${conn.enterpriseId}`
			: 'Unknown connection';
		items.push({ label: alias, detail });
	}

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a Box connection to upload to',
		title: 'Upload Folders to Box Enterprise',
	});
	if (!selected) { return; }

	const result = await getBoxClientForAlias(selected.label);
	if (!result) {
		vscode.window.showErrorMessage(`Failed to connect to Box using "${selected.label}".`);
		return;
	}

	await buildAndShowUploadDiff(result, selected.label);
}

// ─── Build diff and show preview ─────────────────────────────────────────────

async function buildAndShowUploadDiff(
	clientResult: BoxClientResult,
	alias: string,
): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	const root = workspaceFolders[0].uri;
	const foldersDir = vscode.Uri.joinPath(root, 'folders');

	try {
		const stat = await vscode.workspace.fs.stat(foldersDir);
		if (stat.type !== vscode.FileType.Directory) {
			vscode.window.showWarningMessage('folders/ is not a directory.');
			return;
		}
	} catch {
		vscode.window.showWarningMessage('No folders/ directory found in workspace. Download files first.');
		return;
	}

	logCommandHeader(ext.out, `Upload Folders to Box Enterprise (${alias})`);

	const diffItems: UploadDiffItem[] = [];

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Comparing local folders/ with Box (${alias})`,
			cancellable: false,
		},
		async (progress) => {
			const localEntries = await readLocalDirectory(foldersDir);

			// Get root folder items from Box for comparison
			const remoteItems = await getRemoteItems(clientResult.client, '0');

			for (const entry of localEntries) {
				progress.report({ message: entry.name });
				await buildDiffForEntry(
					clientResult.client, entry, '0', remoteItems, diffItems, '',
				);
			}
		},
	);

	if (diffItems.length === 0) {
		vscode.window.showInformationMessage('No files found in folders/ to upload.');
		return;
	}

	openUploadDiffPreview(diffItems, clientResult, alias);
}

// ─── Local filesystem helpers ────────────────────────────────────────────────

async function readLocalDirectory(dirUri: vscode.Uri): Promise<LocalEntry[]> {
	const entries = await vscode.workspace.fs.readDirectory(dirUri);
	const result: LocalEntry[] = [];

	for (const [name, type] of entries) {
		if (name.startsWith('.')) { continue; } // skip hidden files

		const uri = vscode.Uri.joinPath(dirUri, name);
		if (type === vscode.FileType.Directory) {
			const children = await readLocalDirectory(uri);
			result.push({ name, type: 'folder', uri, children });
		} else if (type === vscode.FileType.File) {
			result.push({ name, type: 'file', uri });
		}
	}

	return result.sort((a, b) => {
		if (a.type === 'folder' && b.type !== 'folder') { return -1; }
		if (a.type !== 'folder' && b.type === 'folder') { return 1; }
		return a.name.localeCompare(b.name);
	});
}

// ─── Remote helpers ──────────────────────────────────────────────────────────

async function getRemoteItems(
	client: BoxClient,
	folderId: string,
): Promise<RemoteEntry[]> {
	const items: RemoteEntry[] = [];
	let marker: string | undefined;

	do {
		const response = await client.folders.getFolderItems(folderId, {
			queryParams: {
				fields: ['id', 'name', 'type', 'sha1', 'size', 'created_by', 'created_at'],
				limit: 100,
				usemarker: true,
				...(marker ? { marker } : {}),
			},
		});

		for (const entry of response.entries ?? []) {
			if (entry.id && entry.name) {
				const raw = entry as unknown as Record<string, unknown>;
				const createdBy = raw.created_by as { name?: string } | undefined;
				items.push({
					id: entry.id,
					name: entry.name,
					type: entry.type ?? 'file',
					sha1: raw.sha1 as string | undefined,
					size: raw.size as number | undefined,
					createdBy: createdBy?.name,
					createdAt: raw.created_at as string | undefined,
				});
			}
		}

		marker = response.nextMarker ?? undefined;
	} while (marker);

	return items;
}

// ─── Diff builder ────────────────────────────────────────────────────────────

async function buildDiffForEntry(
	client: BoxClient,
	entry: LocalEntry,
	parentFolderId: string,
	remoteItems: RemoteEntry[],
	diffItems: UploadDiffItem[],
	pathPrefix: string,
): Promise<void> {
	const displayPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
	const remoteMatch = remoteItems.find(r => r.name === entry.name && r.type === entry.type);

	if (entry.type === 'file') {
		const localBytes = await vscode.workspace.fs.readFile(entry.uri);
		const localSha1 = await computeSha1(localBytes);

		if (remoteMatch) {
			const remoteSha1 = remoteMatch.sha1 ?? '';
			const status = localSha1 === remoteSha1 ? 'unchanged' : 'modified';
			diffItems.push({
				displayPath,
				localUri: entry.uri,
				status,
				type: 'file',
				parentFolderId,
				remoteFileId: remoteMatch.id,
				localSha1,
				remoteSha1,
				remoteSize: remoteMatch.size,
				remoteCreatedBy: remoteMatch.createdBy,
				remoteCreatedAt: remoteMatch.createdAt,
			});
		} else {
			// No name match — check if any remote files have identical content (duplicates)
			const sha1Matches = remoteItems.filter(
				r => r.type === 'file' && r.sha1 && r.sha1 === localSha1,
			);
			if (sha1Matches.length > 0) {
				const first = sha1Matches[0];
				diffItems.push({
					displayPath,
					localUri: entry.uri,
					status: 'duplicate',
					type: 'file',
					parentFolderId,
					localSha1,
					remoteSha1: first.sha1,
					remoteMatchNames: sha1Matches.map(m => m.name),
					remoteSize: first.size,
					remoteCreatedBy: first.createdBy,
					remoteCreatedAt: first.createdAt,
				});
			} else {
				diffItems.push({
					displayPath,
					localUri: entry.uri,
					status: 'new',
					type: 'file',
					parentFolderId,
					localSha1,
				});
			}
		}
	} else if (entry.type === 'folder') {
		if (remoteMatch) {
			// Folder exists remotely — recurse into children
			const childRemoteItems = await getRemoteItems(client, remoteMatch.id);
			for (const child of entry.children ?? []) {
				await buildDiffForEntry(
					client, child, remoteMatch.id, childRemoteItems, diffItems, displayPath,
				);
			}
		} else {
			// Folder is new — all children are new
			diffItems.push({
				displayPath,
				localUri: entry.uri,
				status: 'new',
				type: 'folder',
				parentFolderId,
			});
			markAllNew(entry, diffItems, displayPath, '');
		}
	}
}

/** Recursively marks all children of a new folder as 'new'. */
function markAllNew(
	entry: LocalEntry,
	diffItems: UploadDiffItem[],
	pathPrefix: string,
	_parentFolderId: string,
): void {
	for (const child of entry.children ?? []) {
		const childPath = `${pathPrefix}/${child.name}`;
		diffItems.push({
			displayPath: childPath,
			localUri: child.uri,
			status: 'new',
			type: child.type,
			parentFolderId: '', // will be resolved during upload
		});
		if (child.type === 'folder') {
			markAllNew(child, diffItems, childPath, '');
		}
	}
}

// ─── SHA-1 helper ────────────────────────────────────────────────────────────

async function computeSha1(data: Uint8Array): Promise<string> {
	const crypto = await import('crypto');
	return crypto.createHash('sha1').update(data).digest('hex');
}

// ─── Upload execution (called from the diff preview webview) ─────────────────

export async function executeUpload(
	diffItems: UploadDiffItem[],
	clientResult: BoxClientResult,
): Promise<{ successCount: number; failCount: number }> {
	let successCount = 0;
	let failCount = 0;

	// Sort: folders before files, shorter paths first (create parents first)
	const sorted = [...diffItems].filter(i => i.status !== 'unchanged').sort((a, b) => {
		if (a.type === 'folder' && b.type !== 'folder') { return -1; }
		if (a.type !== 'folder' && b.type === 'folder') { return 1; }
		return a.displayPath.localeCompare(b.displayPath);
	});

	// Track created folder IDs so children can reference them
	const folderIdMap = new Map<string, string>();

	for (const item of sorted) {
		try {
			// Resolve parent folder ID for new items inside new parent folders
			let parentId = item.parentFolderId;
			if (!parentId) {
				const parentPath = item.displayPath.split('/').slice(0, -1).join('/');
				parentId = folderIdMap.get(parentPath) ?? '0';
			}

			if (item.type === 'folder' && item.status === 'new') {
				const folderName = item.displayPath.split('/').pop()!;
				const created = await clientResult.client.folders.createFolder({
					name: folderName,
					parent: { id: parentId },
				});
				folderIdMap.set(item.displayPath, created.id);
				successCount++;
				log(ext.out, `[Upload] Created folder: ${item.displayPath}`);
			} else if (item.type === 'file') {
				const fileContent = await vscode.workspace.fs.readFile(item.localUri);
				const fileName = item.displayPath.split('/').pop()!;

				if (item.status === 'new' || item.status === 'duplicate') {
					await uploadNewFile(clientResult.client, parentId, fileName, fileContent);
					successCount++;
					log(ext.out, `[Upload] Uploaded new file: ${item.displayPath}`);
				} else if (item.status === 'modified' && item.remoteFileId) {
					await uploadNewVersion(clientResult.client, item.remoteFileId, fileName, fileContent);
					successCount++;
					log(ext.out, `[Upload] Updated file: ${item.displayPath}`);
				}
			}
		} catch (err) {
			failCount++;
			const message = err instanceof Error ? err.message : String(err);
			log(ext.out, `[Upload] Failed "${item.displayPath}": ${message}`);
		}
	}

	return { successCount, failCount };
}

async function uploadNewFile(
	client: BoxClient,
	parentFolderId: string,
	fileName: string,
	content: Uint8Array,
): Promise<void> {
	const stream = Readable.from(Buffer.from(content));
	await client.uploads.uploadFile({
		attributes: {
			name: fileName,
			parent: { id: parentFolderId },
		},
		file: stream,
	});
}

async function uploadNewVersion(
	client: BoxClient,
	fileId: string,
	fileName: string,
	content: Uint8Array,
): Promise<void> {
	const stream = Readable.from(Buffer.from(content));
	await client.uploads.uploadFileVersion(fileId, {
		attributes: { name: fileName },
		file: stream,
	});
}
