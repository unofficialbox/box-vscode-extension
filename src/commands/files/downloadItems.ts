import * as vscode from 'vscode';
import { BoxClient } from 'box-node-sdk';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getBoxClient } from '../../utils/boxClient';
import { AllFilesItem } from '../../views/allFilesView';

// ─── Public command ──────────────────────────────────────────────────────────

export async function downloadItem(item: AllFilesItem): Promise<void> {
	const result = await getBoxClient();
	if (!result) {
		vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
		return;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return;
	}

	const root = workspaceFolders[0].uri;
	const foldersDir = vscode.Uri.joinPath(root, 'folders');

	// Ensure folders/ directory exists
	try {
		await vscode.workspace.fs.stat(foldersDir);
	} catch {
		await vscode.workspace.fs.createDirectory(foldersDir);
		log(ext.out, '[Download] Created folders/ directory.');
	}

	logCommandHeader(ext.out, 'Box: Download');

	const isFolder = item.itemType === 'folder';
	const typeLabel = isFolder ? 'folder' : 'file';

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Downloading ${typeLabel} "${item.itemName}"`,
			cancellable: false,
		},
		async (progress) => {
			try {
				if (isFolder) {
					await downloadFolder(result.client, item.itemId, item.itemName, foldersDir, progress);
				} else {
					await downloadFile(result.client, item.itemId, item.itemName, foldersDir, progress);
				}
				vscode.window.showInformationMessage(`Downloaded ${typeLabel} "${item.itemName}" to folders/.`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log(ext.out, `[Download] Failed: ${message}`);
				vscode.window.showErrorMessage(`Download failed: ${message}`);
			}
		},
	);
}

// ─── Download helpers ────────────────────────────────────────────────────────

async function downloadFile(
	client: BoxClient,
	fileId: string,
	fileName: string,
	targetDir: vscode.Uri,
	progress?: vscode.Progress<{ message?: string }>,
): Promise<void> {
	progress?.report({ message: fileName });

	const stream = await client.downloads.downloadFile(fileId);
	if (!stream) { throw new Error(`No content returned for file ${fileId}`); }
	const chunks: Buffer[] = [];

	await new Promise<void>((resolve, reject) => {
		stream.on('data', (chunk: Buffer) => chunks.push(chunk));
		stream.on('end', resolve);
		stream.on('error', reject);
	});

	const fileUri = vscode.Uri.joinPath(targetDir, fileName);
	await vscode.workspace.fs.writeFile(fileUri, Buffer.concat(chunks));
	log(ext.out, `[Download] File saved: ${fileUri.fsPath}`);
}

async function downloadFolder(
	client: BoxClient,
	folderId: string,
	folderName: string,
	targetDir: vscode.Uri,
	progress: vscode.Progress<{ message?: string }>,
): Promise<void> {
	const folderUri = vscode.Uri.joinPath(targetDir, folderName);
	await vscode.workspace.fs.createDirectory(folderUri);

	// Fetch all items in the folder (paginated)
	let marker: string | undefined;
	do {
		const response = await client.folders.getFolderItems(folderId, {
			queryParams: {
				fields: ['id', 'name', 'type'],
				limit: 100,
				usemarker: true,
				...(marker ? { marker } : {}),
			},
		});

		const entries = response.entries ?? [];
		for (const entry of entries) {
			if (!entry.id || !entry.name) { continue; }

			if (entry.type === 'folder') {
				await downloadFolder(client, entry.id, entry.name, folderUri, progress);
			} else if (entry.type === 'file') {
				await downloadFile(client, entry.id, entry.name, folderUri, progress);
			}
		}

		marker = response.nextMarker ?? undefined;
	} while (marker);

	log(ext.out, `[Download] Folder saved: ${folderUri.fsPath}`);
}
