import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getBoxClient } from '../utils/boxClient';
import { getConnection } from '../utils/connectionStorage';
import { MetadataTemplate } from 'box-node-sdk/lib/schemas/metadataTemplate';
import { MetadataTaxonomy } from 'box-node-sdk/lib/schemas/metadataTaxonomy';
import { MetadataTaxonomyNode } from 'box-node-sdk/lib/schemas/metadataTaxonomyNode';

// ─── Item types ──────────────────────────────────────────────────────────────

type ConfigItemType = 'category' | 'subcategory' | 'template' | 'taxonomy' | 'taxonomyNode';

export class ConfigurationItem extends vscode.TreeItem {
	constructor(
		public readonly itemType: ConfigItemType,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly scope?: string,
		public readonly template?: MetadataTemplate,
		public readonly taxonomy?: MetadataTaxonomy,
		public readonly taxonomyKey?: string,
		public readonly node?: MetadataTaxonomyNode,
	) {
		super(label, collapsibleState);

		if (itemType === 'category' && label === 'Metadata Taxonomies') {
			this.iconPath = new vscode.ThemeIcon('symbol-class');
			this.contextValue = 'categoryTaxonomies';
		} else if (itemType === 'category') {
			this.iconPath = new vscode.ThemeIcon('symbol-class');
			this.contextValue = 'category';
		} else if (itemType === 'subcategory') {
			this.iconPath = new vscode.ThemeIcon('symbol-class');
			this.contextValue = 'subcategoryTemplates';
		} else if (itemType === 'template' && template) {
			this.iconPath = new vscode.ThemeIcon('note');
			this.description = template.templateKey ?? '';
			this.tooltip = `${template.displayName}\ntemplateKey: ${template.templateKey}\nscope: ${template.scope}`;
			this.contextValue = 'metadataTemplate';
			this.command = {
				command: 'box-vscode-extension.showMetadataTemplate',
				title: 'Show Metadata Template',
				arguments: [this],
			};
		} else if (itemType === 'taxonomy' && taxonomy) {
			this.iconPath = new vscode.ThemeIcon('list-tree');
			this.description = taxonomy.key ?? '';
			this.tooltip = `${taxonomy.displayName}\nkey: ${taxonomy.key}\nnamespace: ${taxonomy.namespace}`;
			this.contextValue = 'metadataTaxonomy';
			this.command = {
				command: 'box-vscode-extension.showMetadataTaxonomy',
				title: 'Show Metadata Taxonomy',
				arguments: [this],
			};
		} else if (itemType === 'taxonomyNode' && node) {
			this.iconPath = new vscode.ThemeIcon('circle-outline');
			this.description = `Level ${node.level}`;
			this.tooltip = `${node.displayName}\nID: ${node.id}\nLevel: ${node.level}`;
			this.contextValue = 'taxonomyNode';
			this.command = {
				command: 'box-vscode-extension.showTaxonomyNode',
				title: 'Show Taxonomy Node',
				arguments: [this],
			};
		}
	}
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class ConfigurationProvider implements vscode.TreeDataProvider<ConfigurationItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<ConfigurationItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private enterpriseCache?: ConfigurationItem[];
	private globalCache?: ConfigurationItem[];
	private taxonomyCache?: ConfigurationItem[];
	private nodeCache = new Map<string, ConfigurationItem[]>();

	refresh(): void {
		this.enterpriseCache = undefined;
		this.globalCache = undefined;
		this.taxonomyCache = undefined;
		this.nodeCache.clear();
		this.allNodesCache.clear();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ConfigurationItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ConfigurationItem): Promise<ConfigurationItem[]> {
		if (!element) {
			return [
				new ConfigurationItem('category', 'Metadata Templates', vscode.TreeItemCollapsibleState.Collapsed),
				new ConfigurationItem('category', 'Metadata Taxonomies', vscode.TreeItemCollapsibleState.Collapsed),
			];
		}

		if (element.itemType === 'category' && element.label === 'Metadata Templates') {
			return [
				new ConfigurationItem('subcategory', 'Enterprise', vscode.TreeItemCollapsibleState.Collapsed, 'enterprise'),
				new ConfigurationItem('subcategory', 'Global', vscode.TreeItemCollapsibleState.Collapsed, 'global'),
			];
		}

		if (element.itemType === 'category' && element.label === 'Metadata Taxonomies') {
			if (this.taxonomyCache) { return this.taxonomyCache; }
			return this.fetchTaxonomies();
		}

		if (element.itemType === 'subcategory' && element.scope === 'enterprise') {
			if (this.enterpriseCache) { return this.enterpriseCache; }
			return this.fetchTemplates('enterprise');
		}

		if (element.itemType === 'subcategory' && element.scope === 'global') {
			if (this.globalCache) { return this.globalCache; }
			return this.fetchTemplates('global');
		}

		if (element.itemType === 'taxonomy' && element.taxonomy && element.scope) {
			const key = element.taxonomy.key;
			if (!key) {
				log(ext.out, `[Configuration] Taxonomy "${element.taxonomy.displayName}" has no key.`);
				return [];
			}
			return this.fetchTaxonomyNodes(element.scope, key, undefined);
		}

		if (element.itemType === 'taxonomyNode' && element.node && element.scope && element.taxonomyKey) {
			return this.fetchTaxonomyNodes(element.scope, element.taxonomyKey, element.node.id);
		}

		return [];
	}

	private async fetchTemplates(scope: 'enterprise' | 'global'): Promise<ConfigurationItem[]> {
		const result = await getBoxClient();
		if (!result) { return []; }
		const { client } = result;

		try {
			const response = scope === 'enterprise'
				? await client.metadataTemplates.getEnterpriseMetadataTemplates()
				: await client.metadataTemplates.getGlobalMetadataTemplates();

			const entries = response.entries ?? [];
			const items = entries
				.filter((t): t is MetadataTemplate & { displayName: string } => !!t.displayName)
				.sort((a, b) => a.displayName.localeCompare(b.displayName))
				.map(t => new ConfigurationItem(
					'template',
					t.displayName,
					vscode.TreeItemCollapsibleState.None,
					scope,
					t,
				));

			if (scope === 'enterprise') {
				this.enterpriseCache = items;
			} else {
				this.globalCache = items;
			}

			if (items.length === 0) {
				return [new ConfigurationItem('template', 'No templates found', vscode.TreeItemCollapsibleState.None)];
			}

			return items;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log(ext.out, `[Configuration] Failed to load ${scope} metadata templates: ${message}`);
			return [new ConfigurationItem('template', 'Failed to load templates', vscode.TreeItemCollapsibleState.None)];
		}
	}

	private async fetchTaxonomies(): Promise<ConfigurationItem[]> {
		const result = await getBoxClient();
		if (!result) { return []; }
		const { client } = result;

		try {
			// Resolve the enterprise namespace from the stored connection
			const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
			const conn = alias ? await getConnection(alias) : undefined;
			const enterpriseId = conn?.enterpriseId;
			if (!enterpriseId) {
				log(ext.out, '[Configuration] No enterprise ID found on stored connection. Re-authorize to populate it.');
				return [new ConfigurationItem('taxonomy', 'No enterprise found — re-authorize connection', vscode.TreeItemCollapsibleState.None)];
			}

			const namespace = `enterprise_${enterpriseId}`;
			const response = await client.metadataTaxonomies.getMetadataTaxonomies(namespace);
			const entries = response.entries ?? [];

			const items = entries
				.filter((t): t is MetadataTaxonomy & { displayName: string } => !!t.displayName)
				.sort((a, b) => a.displayName.localeCompare(b.displayName))
				.map(t => new ConfigurationItem(
					'taxonomy',
					t.displayName,
					vscode.TreeItemCollapsibleState.Collapsed,
					namespace,
					undefined,
					t,
				));

			this.taxonomyCache = items;

			if (items.length === 0) {
				return [new ConfigurationItem('taxonomy', 'No taxonomies found', vscode.TreeItemCollapsibleState.None)];
			}

			return items;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log(ext.out, `[Configuration] Failed to load metadata taxonomies: ${message}`);
			return [new ConfigurationItem('taxonomy', 'Failed to load taxonomies', vscode.TreeItemCollapsibleState.None)];
		}
	}

	/** Cache of all nodes for a given taxonomy (namespace:taxonomyKey → flat list). */
	private allNodesCache = new Map<string, MetadataTaxonomyNode[]>();

	private async fetchAllTaxonomyNodes(
		namespace: string,
		taxonomyKey: string,
	): Promise<MetadataTaxonomyNode[]> {
		const cacheKey = `${namespace}:${taxonomyKey}`;
		const cached = this.allNodesCache.get(cacheKey);
		if (cached) { return cached; }

		const result = await getBoxClient();
		if (!result) { return []; }
		const { client } = result;

		log(ext.out, `[Configuration] Fetching all taxonomy nodes for ${namespace}/${taxonomyKey}…`);

		const allNodes: MetadataTaxonomyNode[] = [];
		let marker: string | undefined;

		do {
			const response = await client.metadataTaxonomies.getMetadataTaxonomyNodes(
				namespace, taxonomyKey,
				marker ? { queryParams: { marker } } : undefined,
			);
			const entries = response.entries ?? [];
			allNodes.push(...entries);
			marker = response.nextMarker ?? undefined;
		} while (marker);

		log(ext.out, `[Configuration] Fetched ${allNodes.length} taxonomy nodes.`);
		this.allNodesCache.set(cacheKey, allNodes);
		return allNodes;
	}

	private async fetchTaxonomyNodes(
		namespace: string,
		taxonomyKey: string,
		parentId: string | undefined,
	): Promise<ConfigurationItem[]> {
		const viewCacheKey = `${namespace}:${taxonomyKey}:${parentId ?? 'root'}`;
		const cached = this.nodeCache.get(viewCacheKey);
		if (cached) { return cached; }

		try {
			const allNodes = await this.fetchAllTaxonomyNodes(namespace, taxonomyKey);

			const filtered = parentId
				? allNodes.filter(n => n.parentId === parentId)
				: allNodes.filter(n => !n.parentId);

			// Determine which nodes have children so we can set the right collapsible state
			const parentIds = new Set(allNodes.filter(n => n.parentId).map(n => n.parentId!));

			const items = filtered
				.sort((a, b) => a.displayName.localeCompare(b.displayName))
				.map(n => new ConfigurationItem(
					'taxonomyNode',
					n.displayName,
					parentIds.has(n.id)
						? vscode.TreeItemCollapsibleState.Collapsed
						: vscode.TreeItemCollapsibleState.None,
					namespace,
					undefined,
					undefined,
					taxonomyKey,
					n,
				));

			this.nodeCache.set(viewCacheKey, items);

			if (items.length === 0) {
				return [new ConfigurationItem('taxonomyNode', 'No nodes found', vscode.TreeItemCollapsibleState.None)];
			}

			return items;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log(ext.out, `[Configuration] Failed to load taxonomy nodes for ${namespace}/${taxonomyKey} (parent=${parentId ?? 'root'}): ${message}`);
			if (err && typeof err === 'object' && 'responseBody' in err) {
				log(ext.out, `[Configuration] Response body: ${JSON.stringify((err as Record<string, unknown>).responseBody)}`);
			}
			return [new ConfigurationItem('taxonomyNode', 'Failed to load nodes', vscode.TreeItemCollapsibleState.None)];
		}
	}
}
