import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';

// ─── Item types ──────────────────────────────────────────────────────────────

type ItemType = 'file' | 'folder' | 'web_link' | 'load_more';

export class AllFilesItem extends vscode.TreeItem {
	constructor(
		public readonly itemId: string,
		public readonly itemName: string,
		public readonly itemType: ItemType,
		public readonly parentFolderId?: string,
		public readonly nextMarker?: string,
	) {
		const isFolder = itemType === 'folder';
		const isLoadMore = itemType === 'load_more';

		super(
			itemName,
			isFolder
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
		);

		if (isLoadMore) {
			this.command = {
				command: 'box-vscode-extension.allFilesLoadMore',
				title: 'Load More',
				arguments: [this],
			};
			this.iconPath = new vscode.ThemeIcon('ellipsis');
		} else if (isFolder) {
			this.iconPath = new vscode.ThemeIcon('folder');
		} else {
			this.iconPath = new vscode.ThemeIcon('file');
			this.command = {
				command: 'box-vscode-extension.previewFile',
				title: 'Preview File',
				arguments: [this],
			};
		}

		this.contextValue = itemType;
	}
}

// ─── Provider ────────────────────────────────────────────────────────────────

const PAGE_LIMIT = 100;

export class AllFilesProvider implements vscode.TreeDataProvider<AllFilesItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<AllFilesItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	/** Cached children per folder id (includes the "Load More" item if applicable). */
	private cache = new Map<string, AllFilesItem[]>();

	refresh(): void {
		this.cache.clear();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: AllFilesItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: AllFilesItem): Promise<AllFilesItem[]> {
		if (element?.itemType === 'load_more') {
			return [];
		}

		const folderId = element?.itemId ?? '0';

		const cached = this.cache.get(folderId);
		if (cached) { return cached; }

		return this.fetchPage(folderId);
	}

	/** Fetches a page of items for `folderId` and stores them in the cache. */
	async fetchPage(folderId: string, marker?: string): Promise<AllFilesItem[]> {
		const result = await getBoxClient();
		if (!result) { return []; }
		const { client } = result;

		try {
			const response = await client.folders.getFolderItems(folderId, {
				queryParams: {
					fields: ['id', 'name', 'type'],
					limit: PAGE_LIMIT,
					usemarker: true,
					...(marker ? { marker } : {}),
				},
			});

			const entries = response.entries ?? [];
			const items: AllFilesItem[] = entries
				.filter((e): e is typeof e & { id: string; name: string } => !!e.id && !!e.name)
				.map(e => new AllFilesItem(e.id, e.name, (e.type ?? 'file') as ItemType));

			// Sort folders first, then files, alphabetically within each group
			items.sort((a, b) => {
				if (a.itemType === 'folder' && b.itemType !== 'folder') { return -1; }
				if (a.itemType !== 'folder' && b.itemType === 'folder') { return 1; }
				return a.itemName.localeCompare(b.itemName);
			});

			// Append to any existing cached items (for "Load More" pagination)
			const existing = this.cache.get(folderId) ?? [];
			// Remove previous "Load More" item if present
			const withoutLoadMore = existing.filter(i => i.itemType !== 'load_more');
			const merged = [...withoutLoadMore, ...items];

			// Add "Load More" if there are more pages
			if (response.nextMarker) {
				merged.push(new AllFilesItem(
					`load_more_${folderId}`,
					'Load More\u2026',
					'load_more',
					folderId,
					response.nextMarker,
				));
			}

			this.cache.set(folderId, merged);
			return merged;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log(ext.out, `[AllFiles] Failed to load folder ${folderId}: ${message}`);
			return [new AllFilesItem('error', 'Failed to load items', 'file')];
		}
	}

	/** Called by the "Load More" command to fetch the next page and refresh the parent. */
	async loadMore(item: AllFilesItem): Promise<void> {
		if (!item.parentFolderId || !item.nextMarker) { return; }
		await this.fetchPage(item.parentFolderId, item.nextMarker);
		this._onDidChangeTreeData.fire();
	}
}
