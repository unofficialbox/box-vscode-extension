import * as vscode from 'vscode';

// ─── Item types ──────────────────────────────────────────────────────────────

type UIElementType = 'contentUploader' | 'contentPicker' | 'contentPreview' | 'contentExplorer' | 'metadataQueryBuilder';

interface UIElementDef {
	type: UIElementType;
	label: string;
	icon: string;
	description: string;
}

const UI_ELEMENTS: UIElementDef[] = [
	{ type: 'contentUploader', label: 'Content Uploader', icon: 'cloud-upload', description: 'Upload files to a Box folder' },
	{ type: 'contentPicker', label: 'Content Picker', icon: 'file-symlink-file', description: 'Pick files or folders from Box' },
	{ type: 'contentPreview', label: 'Content Preview', icon: 'eye', description: 'Preview a Box file' },
	{ type: 'contentExplorer', label: 'Content Explorer', icon: 'folder-opened', description: 'Browse files and folders in Box' },
{ type: 'metadataQueryBuilder', label: 'Metadata Query', icon: 'search', description: 'Build and execute metadata queries' },
];

export class UIElementsItem extends vscode.TreeItem {
	constructor(
		public readonly elementType: UIElementType,
		def: UIElementDef,
	) {
		super(def.label, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(def.icon);
		this.tooltip = def.description;
		this.contextValue = def.type;
		this.command = def.type === 'metadataQueryBuilder'
			? { command: 'box-vscode-extension.openMetadataQueryBuilder', title: 'Open Metadata Query Builder' }
			: { command: 'box-vscode-extension.openUIElement', title: `Open ${def.label}`, arguments: [this] };
	}
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class UIElementsProvider implements vscode.TreeDataProvider<UIElementsItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<UIElementsItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: UIElementsItem): vscode.TreeItem {
		return element;
	}

	getChildren(_element?: UIElementsItem): Thenable<UIElementsItem[]> {
		return Promise.resolve(
			UI_ELEMENTS.map(def => new UIElementsItem(def.type, def)),
		);
	}
}
