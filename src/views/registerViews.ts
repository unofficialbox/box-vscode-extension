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

	return [
		vscode.window.registerTreeDataProvider('box-vscode-extension.allFilesView', allFilesProvider),
		vscode.window.registerTreeDataProvider('box-vscode-extension.configurationView', configurationProvider),
		vscode.window.registerTreeDataProvider('box-vscode-extension.uiElementsView', uiElementsProvider),
		vscode.commands.registerCommand('box-vscode-extension.allFilesLoadMore', (item: AllFilesItem) => {
			return allFilesProvider.loadMore(item);
		}),
		vscode.commands.registerCommand('box-vscode-extension.refreshAllFiles', () => {
			allFilesProvider.refresh();
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
