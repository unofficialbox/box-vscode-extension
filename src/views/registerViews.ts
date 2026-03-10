import * as vscode from 'vscode';
import { AllFilesProvider, AllFilesItem } from './allFilesView';
import { ConfigurationProvider, ConfigurationItem } from './configurationView';
import { UIElementsProvider, UIElementsItem } from './uiElementsView';
import { openContentPreview } from '../webview/contentPreview';
import { openMetadataTemplateDetail, saveTemplateJson } from '../webview/metadataTemplateDetail';
import { openMetadataTaxonomyDetail, openMetadataTaxonomyNodeDetail, saveTaxonomyJson } from '../webview/metadataTaxonomyDetail';
import { openCreateMetadataTemplate } from '../webview/createMetadataTemplate';
import { openCreateMetadataTaxonomy } from '../webview/createMetadataTaxonomy';
import { openUIElement } from '../webview/uiElement';
import { openMetadataQueryBuilder } from '../webview/metadataQueryBuilder';
import { getBoxClient } from '../utils/boxClient';

export function registerViews(): vscode.Disposable[] {
	const allFilesProvider = new AllFilesProvider();
	const configurationProvider = new ConfigurationProvider();
	const uiElementsProvider = new UIElementsProvider();

	const allFilesTreeView = vscode.window.createTreeView('box-vscode-extension.allFilesView', {
		treeDataProvider: allFilesProvider,
	});

	// Update the tree view description when filter changes
	allFilesProvider.onDidChangeTreeData(() => {
		allFilesTreeView.description = allFilesProvider.filterText
			? `Filter: "${allFilesProvider.filterText}"`
			: undefined;
	});

	return [
		allFilesTreeView,
		vscode.window.registerTreeDataProvider('box-vscode-extension.configurationView', configurationProvider),
		vscode.window.registerTreeDataProvider('box-vscode-extension.uiElementsView', uiElementsProvider),
		vscode.commands.registerCommand('box-vscode-extension.allFilesLoadMore', (item: AllFilesItem) => {
			return allFilesProvider.loadMore(item);
		}),
		vscode.commands.registerCommand('box-vscode-extension.refreshAllFiles', () => {
			allFilesProvider.refresh();
		}),
		vscode.commands.registerCommand('box-vscode-extension.filterAllFiles', async () => {
			const text = await vscode.window.showInputBox({
				title: 'Box: Filter All Files',
				prompt: 'Show only files and folders containing this text',
				placeHolder: 'Type to filter…',
				value: allFilesProvider.filterText,
			});
			if (text === undefined) { return; } // cancelled
			allFilesProvider.setFilter(text);
		}),
		vscode.commands.registerCommand('box-vscode-extension.clearFilterAllFiles', () => {
			allFilesProvider.clearFilter();
		}),
		vscode.commands.registerCommand('box-vscode-extension.previewFile', (item: AllFilesItem) => {
			return openContentPreview(item.itemId, item.itemName);
		}),
		vscode.commands.registerCommand('box-vscode-extension.refreshConfiguration', () => {
			configurationProvider.refresh();
		}),
		vscode.commands.registerCommand('box-vscode-extension.showMetadataTemplate', (item: ConfigurationItem) => {
			if (item.template) {
				openMetadataTemplateDetail(item.template);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.showMetadataTaxonomy', (item: ConfigurationItem) => {
			if (item.taxonomy && item.scope) {
				return openMetadataTaxonomyDetail(item.taxonomy, item.scope);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.showTaxonomyNode', (item: ConfigurationItem) => {
			if (item.node && item.scope && item.taxonomyKey) {
				// We need the taxonomy object — fetch it from the parent context
				// Use the taxonomyKey and scope to open the detail with focus on this node
				return openTaxonomyNodeFromItem(item);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.copyToClipboard', async (arg: string | ConfigurationItem) => {
			const text = typeof arg === 'string'
				? arg
				: arg.template?.templateKey ?? arg.taxonomy?.key ?? '';
			if (!text) { return; }
			await vscode.env.clipboard.writeText(text);
			vscode.window.showInformationMessage(`Copied: ${text}`);
		}),
		vscode.commands.registerCommand('box-vscode-extension.saveMetadataTemplateJson', async (item: ConfigurationItem) => {
			if (item.template) {
				await saveTemplateJson(item.template);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.saveMetadataTaxonomyJson', async (item: ConfigurationItem) => {
			if (item.taxonomy) {
				await saveTaxonomyJson(item.taxonomy);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.createMetadataTemplate', () => {
			openCreateMetadataTemplate();
		}),
		vscode.commands.registerCommand('box-vscode-extension.createMetadataTaxonomy', () => {
			return openCreateMetadataTaxonomy();
		}),
		vscode.commands.registerCommand('box-vscode-extension.openUIElement', (item: UIElementsItem) => {
			return openUIElement(item.elementType);
		}),
		vscode.commands.registerCommand('box-vscode-extension.copyFolderId', async (item: AllFilesItem) => {
			await vscode.env.clipboard.writeText(item.itemId);
			vscode.window.showInformationMessage(`Copied Folder ID: ${item.itemId}`);
		}),
		vscode.commands.registerCommand('box-vscode-extension.copyFileId', async (item: AllFilesItem) => {
			await vscode.env.clipboard.writeText(item.itemId);
			vscode.window.showInformationMessage(`Copied File ID: ${item.itemId}`);
		}),
		vscode.commands.registerCommand('box-vscode-extension.showContentUploader', (item: AllFilesItem) => {
			return openUIElement('contentUploader', item.itemId);
		}),
		vscode.commands.registerCommand('box-vscode-extension.showContentPicker', (item: AllFilesItem) => {
			return openUIElement('contentPicker', item.itemId);
		}),
		vscode.commands.registerCommand('box-vscode-extension.showContentExplorer', (item: AllFilesItem) => {
			return openUIElement('contentExplorer', item.itemId);
		}),
		vscode.commands.registerCommand('box-vscode-extension.createFolder', async (item: AllFilesItem) => {
			const name = await vscode.window.showInputBox({
				title: 'Box: Create Folder',
				prompt: `Create a new folder inside "${item.itemName}"`,
				placeHolder: 'Folder name',
				ignoreFocusOut: true,
				validateInput: v => (!v || !v.trim()) ? 'Folder name is required' : null,
			});
			if (!name) { return; }

			const result = await getBoxClient();
			if (!result) {
				vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
				return;
			}

			try {
				const folder = await result.client.folders.createFolder({
					name: name.trim(),
					parent: { id: item.itemId },
				});
				vscode.window.showInformationMessage(`Folder "${folder.name}" created.`);
				allFilesProvider.refresh();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Failed to create folder: ${message}`);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.createFolderAtRoot', async () => {
			const name = await vscode.window.showInputBox({
				title: 'Box: Create Folder',
				prompt: 'Create a new folder in the root directory',
				placeHolder: 'Folder name',
				ignoreFocusOut: true,
				validateInput: v => (!v || !v.trim()) ? 'Folder name is required' : null,
			});
			if (!name) { return; }

			const result = await getBoxClient();
			if (!result) {
				vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
				return;
			}

			try {
				const folder = await result.client.folders.createFolder({
					name: name.trim(),
					parent: { id: '0' },
				});
				vscode.window.showInformationMessage(`Folder "${folder.name}" created.`);
				allFilesProvider.refresh();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Failed to create folder: ${message}`);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.refreshFolder', (item: AllFilesItem) => {
			allFilesProvider.refreshFolder(item.itemId);
		}),
		vscode.commands.registerCommand('box-vscode-extension.deleteItem', async (item: AllFilesItem) => {
			const typeLabel = item.itemType === 'folder' ? 'folder' : 'file';
			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to delete the ${typeLabel} "${item.itemName}"?`,
				{ modal: true },
				'Delete',
			);
			if (confirm !== 'Delete') { return; }

			const result = await getBoxClient();
			if (!result) {
				vscode.window.showErrorMessage('No Box connection available. Run "Box: Authorize Connection" first.');
				return;
			}

			try {
				if (item.itemType === 'folder') {
					await result.client.folders.deleteFolderById(item.itemId, { queryParams: { recursive: true } });
				} else {
					await result.client.files.deleteFileById(item.itemId);
				}
				vscode.window.showInformationMessage(`${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} "${item.itemName}" deleted.`);
				allFilesProvider.refresh();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Failed to delete ${typeLabel}: ${message}`);
			}
		}),
		vscode.commands.registerCommand('box-vscode-extension.openMetadataQueryBuilder', () => {
			return openMetadataQueryBuilder();
		}),
	];
}

async function openTaxonomyNodeFromItem(item: ConfigurationItem): Promise<void> {
	const result = await getBoxClient();
	if (!result) { return; }

	const taxonomy = await result.client.metadataTaxonomies.getMetadataTaxonomyByKey(
		item.scope!, item.taxonomyKey!,
	);
	await openMetadataTaxonomyNodeDetail(taxonomy, item.scope!, item.node!.id);
}
