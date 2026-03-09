import * as vscode from 'vscode';
import { BoxClient } from 'box-node-sdk';
import {
	CreateMetadataTemplateRequestBody,
	CreateMetadataTemplateRequestBodyFieldsTypeField,
	UpdateMetadataTemplateRequestBody,
} from 'box-node-sdk/lib/managers/metadataTemplates';
import { CreateMetadataTaxonomyRequestBody } from 'box-node-sdk/lib/managers/metadataTaxonomies';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getBoxClientForAlias, BoxClientResult } from '../../utils/boxClient';
import { getConnectionAliases, getConnection } from '../../utils/connectionStorage';

// ─── JSON shapes (matching saved template/taxonomy formats) ─────────────────

export interface TemplateFieldJson {
	type: string;
	key: string;
	displayName: string;
	description?: string;
	hidden?: boolean;
	options?: { key: string }[];
}

export interface TemplateJson {
	scope?: string;
	templateKey: string;
	displayName: string;
	hidden?: boolean;
	copyInstanceOnItemCopy?: boolean;
	fields?: TemplateFieldJson[];
}

export interface TaxonomyLevelJson {
	level: number;
	displayName: string;
	description?: string;
}

export interface TaxonomyNodeJson {
	id?: string;
	displayName: string;
	level: number;
	parentId?: string | null;
}

export interface TaxonomyJson {
	key: string;
	displayName: string;
	namespace?: string;
	levels?: TaxonomyLevelJson[];
	nodes?: TaxonomyNodeJson[];
}

// ─── Public commands ────────────────────────────────────────────────────────

export async function deployToCurrentEnterprise(uri?: vscode.Uri): Promise<void> {
	const resolved = uri ?? await promptForDeployTarget();
	if (!resolved) { return; }

	const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
	if (!alias) {
		vscode.window.showErrorMessage('No default Box connection available. Please authorize a connection first.');
		return;
	}

	const result = await getBoxClientForAlias(alias);
	if (!result) {
		vscode.window.showErrorMessage(`Failed to connect to Box using default connection "${alias}".`);
		return;
	}

	const conn = await getConnection(alias);
	const enterpriseId = conn?.enterpriseId ?? '';

	await deployFromUri(resolved, result, alias, enterpriseId);
}

export async function deployToTargetEnterprise(uri?: vscode.Uri): Promise<void> {
	const resolved = uri ?? await promptForDeployTarget();
	if (!resolved) { return; }

	const aliases = await getConnectionAliases();
	if (aliases.length === 0) {
		vscode.window.showErrorMessage('No Box connections available. Please authorize a connection first.');
		return;
	}

	// Build quick pick items with connection details
	const items: vscode.QuickPickItem[] = [];
	for (const alias of aliases) {
		const conn = await getConnection(alias);
		const detail = conn
			? `${conn.userLogin} — Enterprise ${conn.enterpriseId}`
			: 'Unknown connection';
		items.push({ label: alias, detail });
	}

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a Box connection to deploy to',
		title: 'Deploy to Target Box Enterprise',
	});
	if (!selected) { return; }

	const result = await getBoxClientForAlias(selected.label);
	if (!result) {
		vscode.window.showErrorMessage(`Failed to connect to Box using "${selected.label}".`);
		return;
	}

	const conn = await getConnection(selected.label);
	const enterpriseId = conn?.enterpriseId ?? '';

	await deployFromUri(resolved, result, selected.label, enterpriseId);
}

// ─── Prompt for deploy target (command palette invocation) ──────────────────

export async function promptForDeployTarget(): Promise<vscode.Uri | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return undefined;
	}

	const root = workspaceFolders[0].uri;
	const items: vscode.QuickPickItem[] = [];
	const uriMap = new Map<string, vscode.Uri>();

	for (const dirName of ['metadata-templates', 'metadata-taxonomies']) {
		const dirUri = vscode.Uri.joinPath(root, dirName);
		try {
			const stat = await vscode.workspace.fs.stat(dirUri);
			if (stat.type !== vscode.FileType.Directory) { continue; }
		} catch {
			continue;
		}

		// Add the directory itself
		items.push({ label: dirName, description: 'directory — deploy all files' });
		uriMap.set(dirName, dirUri);

		// Add individual JSON files
		const entries = await vscode.workspace.fs.readDirectory(dirUri);
		for (const [name, type] of entries) {
			if (type === vscode.FileType.File && name.endsWith('.json')) {
				const key = `${dirName}/${name}`;
				items.push({ label: key, description: 'file' });
				uriMap.set(key, vscode.Uri.joinPath(dirUri, name));
			}
		}
	}

	if (items.length === 0) {
		vscode.window.showWarningMessage('No metadata-templates or metadata-taxonomies directories found in workspace.');
		return undefined;
	}

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a directory or file to deploy',
		title: 'Deploy Metadata',
	});
	if (!selected) { return undefined; }

	return uriMap.get(selected.label);
}

// ─── Core deploy logic ──────────────────────────────────────────────────────

async function deployFromUri(
	uri: vscode.Uri,
	clientResult: BoxClientResult,
	alias: string,
	enterpriseId: string,
): Promise<void> {
	logCommandHeader(ext.out, `Deploy to Box Enterprise (${alias})`);

	const stat = await vscode.workspace.fs.stat(uri);
	const files: vscode.Uri[] = [];

	if (stat.type === vscode.FileType.Directory) {
		// Collect all .json files in the directory
		const entries = await vscode.workspace.fs.readDirectory(uri);
		for (const [name, type] of entries) {
			if (type === vscode.FileType.File && name.endsWith('.json')) {
				files.push(vscode.Uri.joinPath(uri, name));
			}
		}
	} else if (stat.type === vscode.FileType.File && uri.fsPath.endsWith('.json')) {
		files.push(uri);
	}

	if (files.length === 0) {
		vscode.window.showWarningMessage('No JSON files found to deploy.');
		return;
	}

	// Determine if this is a templates or taxonomies directory
	const dirName = getDirContext(uri, stat.type);

	let successCount = 0;
	let failCount = 0;

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Deploying to ${alias}`,
			cancellable: false,
		},
		async (progress) => {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const fileName = file.fsPath.split('/').pop() ?? file.fsPath;
				progress.report({
					message: `${fileName} (${i + 1}/${files.length})`,
					increment: (100 / files.length),
				});

				try {
					const content = Buffer.from(
						await vscode.workspace.fs.readFile(file),
					).toString('utf-8');
					const json = JSON.parse(content);

					if (dirName === 'metadata-templates' || isTemplateJson(json)) {
						await deployTemplate(clientResult.client, json as TemplateJson);
					} else if (dirName === 'metadata-taxonomies' || isTaxonomyJson(json)) {
						await deployTaxonomy(clientResult.client, json as TaxonomyJson, enterpriseId);
					} else {
						log(ext.out, `[Deploy] Skipping "${fileName}": unable to determine type (not a template or taxonomy).`);
						failCount++;
						continue;
					}
					successCount++;
				} catch (err) {
					failCount++;
					const message = err instanceof Error ? err.message : String(err);
					log(ext.out, `[Deploy] Failed to deploy "${fileName}": ${message}`);
				}
			}
		},
	);

	const summary = `Deploy complete: ${successCount} succeeded, ${failCount} failed.`;
	log(ext.out, `[Deploy] ${summary}`);

	if (failCount > 0) {
		vscode.window.showWarningMessage(summary);
	} else {
		vscode.window.showInformationMessage(summary);
	}

	vscode.commands.executeCommand('box-vscode-extension.refreshConfiguration');
}

// ─── Type detection ──────────────────────────────────────────────────────────

export function getDirContext(uri: vscode.Uri, fileType: vscode.FileType): string {
	const parts = uri.fsPath.split('/');
	if (fileType === vscode.FileType.Directory) {
		return parts[parts.length - 1];
	}
	// For files, check parent directory name
	return parts[parts.length - 2] ?? '';
}

export function isTemplateJson(json: Record<string, unknown>): boolean {
	return typeof json.templateKey === 'string' && typeof json.displayName === 'string';
}

export function isTaxonomyJson(json: Record<string, unknown>): boolean {
	return typeof json.key === 'string' && typeof json.displayName === 'string'
		&& (Array.isArray(json.levels) || Array.isArray(json.nodes));
}

// ─── Template deployment ─────────────────────────────────────────────────────

export async function deployTemplate(client: BoxClient, template: TemplateJson): Promise<void> {
	const templateKey = template.templateKey;
	const scope = template.scope === 'global' ? 'global' : 'enterprise';

	// Check if template already exists
	const existing = await findExistingTemplate(client, scope, templateKey);

	if (existing) {
		await updateExistingTemplate(client, scope, templateKey, template, existing);
		log(ext.out, `[Deploy] Updated metadata template "${templateKey}".`);
	} else {
		await createNewTemplate(client, template);
		log(ext.out, `[Deploy] Created metadata template "${templateKey}".`);
	}
}

export async function findExistingTemplate(
	client: BoxClient,
	scope: string,
	templateKey: string,
): Promise<TemplateJson | undefined> {
	try {
		const templates = scope === 'global'
			? await client.metadataTemplates.getGlobalMetadataTemplates()
			: await client.metadataTemplates.getEnterpriseMetadataTemplates();

		const match = (templates.entries ?? []).find(
			t => t.templateKey === templateKey,
		);
		if (!match) { return undefined; }

		return {
			templateKey: match.templateKey ?? '',
			displayName: match.displayName ?? '',
			hidden: match.hidden ?? false,
			copyInstanceOnItemCopy: match.copyInstanceOnItemCopy ?? false,
			fields: (match.fields ?? []).map(f => ({
				type: f.type,
				key: f.key,
				displayName: f.displayName,
				description: f.description ?? undefined,
				hidden: f.hidden ?? undefined,
				options: f.options?.map(o => ({ key: o.key })),
			})),
		};
	} catch {
		return undefined;
	}
}

async function createNewTemplate(client: BoxClient, template: TemplateJson): Promise<void> {
	const fields = (template.fields ?? []).map(f => {
		const field: {
			type: CreateMetadataTemplateRequestBodyFieldsTypeField;
			key: string;
			displayName: string;
			description?: string;
			hidden?: boolean;
			options?: { key: string }[];
		} = {
			type: f.type as CreateMetadataTemplateRequestBodyFieldsTypeField,
			key: f.key,
			displayName: f.displayName,
		};
		if (f.description) { field.description = f.description; }
		if (f.hidden) { field.hidden = f.hidden; }
		if ((f.type === 'enum' || f.type === 'multiSelect') && f.options && f.options.length > 0) {
			field.options = f.options.map(o => ({ key: o.key }));
		}
		return field;
	});

	const requestBody: CreateMetadataTemplateRequestBody = {
		scope: 'enterprise',
		displayName: template.displayName,
		...(template.templateKey ? { templateKey: template.templateKey } : {}),
		...(template.hidden ? { hidden: true } : {}),
		...(template.copyInstanceOnItemCopy ? { copyInstanceOnItemCopy: true } : {}),
		...(fields.length > 0 ? { fields } : {}),
	};

	await client.metadataTemplates.createMetadataTemplate(requestBody);
}

async function updateExistingTemplate(
	client: BoxClient,
	scope: string,
	templateKey: string,
	desired: TemplateJson,
	existing: TemplateJson,
): Promise<void> {
	const ops: UpdateMetadataTemplateRequestBody[] = [];

	// Display name change
	if (desired.displayName !== existing.displayName) {
		ops.push({ op: 'editTemplate', data: { displayName: desired.displayName } });
	}

	const existingFields = new Map((existing.fields ?? []).map(f => [f.key, f]));
	const desiredFields = new Map((desired.fields ?? []).map(f => [f.key, f]));

	// Remove fields not in desired
	for (const key of existingFields.keys()) {
		if (!desiredFields.has(key)) {
			ops.push({ op: 'removeField', fieldKey: key });
		}
	}

	// Add new fields / edit existing fields
	for (const [key, field] of desiredFields) {
		const orig = existingFields.get(key);

		if (!orig) {
			// New field
			const addData: Record<string, unknown> = {
				type: field.type,
				key: field.key,
				displayName: field.displayName,
			};
			if (field.description) { addData.description = field.description; }
			if (field.hidden) { addData.hidden = true; }
			if ((field.type === 'enum' || field.type === 'multiSelect') && field.options && field.options.length > 0) {
				addData.options = field.options.map(o => ({ key: o.key }));
			}
			ops.push({ op: 'addField', data: addData });
		} else {
			// Edit existing field
			const editData: Record<string, unknown> = {};
			if (field.displayName !== orig.displayName) { editData.displayName = field.displayName; }
			if ((field.description || '') !== (orig.description || '')) { editData.description = field.description; }

			if (Object.keys(editData).length > 0) {
				ops.push({ op: 'editField', fieldKey: key, data: editData });
			}

			// Enum/multiSelect option changes
			if (field.type === 'enum' || field.type === 'multiSelect') {
				const origOpts = new Set((orig.options ?? []).map(o => o.key));
				const newOpts = new Set((field.options ?? []).map(o => o.key));

				for (const opt of newOpts) {
					if (!origOpts.has(opt)) {
						ops.push(field.type === 'enum'
							? { op: 'addEnumOption', fieldKey: key, data: { key: opt } }
							: { op: 'addMultiSelectOption', fieldKey: key, data: { key: opt } },
						);
					}
				}
				for (const opt of origOpts) {
					if (!newOpts.has(opt)) {
						ops.push(field.type === 'enum'
							? { op: 'removeEnumOption', fieldKey: key, enumOptionKey: opt }
							: { op: 'removeMultiSelectOption', fieldKey: key, multiSelectOptionKey: opt },
						);
					}
				}
			}
		}
	}

	if (ops.length === 0) {
		log(ext.out, `[Deploy] Template "${templateKey}" is already up to date.`);
		return;
	}

	await client.metadataTemplates.updateMetadataTemplate(scope, templateKey, ops);
}

// ─── Taxonomy deployment ─────────────────────────────────────────────────────

export async function deployTaxonomy(
	client: BoxClient,
	taxonomy: TaxonomyJson,
	enterpriseId: string,
): Promise<void> {
	// Always use the target enterprise's namespace, not the one from the JSON file.
	// The JSON file's namespace (e.g. "enterprise_12345") is from the source enterprise
	// and would cause a 403 when the target client tries to access it.
	const namespace = enterpriseId ? `enterprise_${enterpriseId}` : taxonomy.namespace || '';
	if (!namespace) {
		throw new Error(`Cannot deploy taxonomy "${taxonomy.key}": no enterprise ID available for target connection.`);
	}

	const taxonomyKey = taxonomy.key;

	// Check if taxonomy already exists
	const existing = await findExistingTaxonomy(client, namespace, taxonomyKey);

	if (existing) {
		await updateExistingTaxonomy(client, namespace, taxonomyKey, taxonomy, existing);
		log(ext.out, `[Deploy] Updated metadata taxonomy "${taxonomyKey}".`);
	} else {
		await createNewTaxonomy(client, taxonomy, namespace);
		log(ext.out, `[Deploy] Created metadata taxonomy "${taxonomyKey}".`);
	}
}

export async function findExistingTaxonomy(
	client: BoxClient,
	namespace: string,
	taxonomyKey: string,
): Promise<TaxonomyJson | undefined> {
	try {
		const taxonomy = await client.metadataTaxonomies.getMetadataTaxonomyByKey(namespace, taxonomyKey);
		// Fetch all nodes
		const allNodes: TaxonomyNodeJson[] = [];
		let marker: string | undefined;
		do {
			const response = await client.metadataTaxonomies.getMetadataTaxonomyNodes(
				namespace, taxonomyKey,
				marker ? { queryParams: { marker } } : undefined,
			);
			const entries = response.entries ?? [];
			for (const n of entries) {
				allNodes.push({
					id: n.id,
					displayName: n.displayName,
					level: n.level,
					parentId: n.parentId ?? null,
				});
			}
			marker = response.nextMarker ?? undefined;
		} while (marker);

		return {
			key: taxonomy.key ?? '',
			displayName: taxonomy.displayName ?? '',
			namespace: taxonomy.namespace ?? '',
			levels: (taxonomy.levels ?? []).map(l => ({
				level: l.level ?? 0,
				displayName: l.displayName ?? '',
				description: l.description ?? '',
			})),
			nodes: allNodes,
		};
	} catch {
		return undefined;
	}
}

async function createNewTaxonomy(
	client: BoxClient,
	taxonomy: TaxonomyJson,
	namespace: string,
): Promise<void> {
	const requestBody: CreateMetadataTaxonomyRequestBody = {
		displayName: taxonomy.displayName,
		namespace,
		...(taxonomy.key ? { key: taxonomy.key } : {}),
	};

	await client.metadataTaxonomies.createMetadataTaxonomy(requestBody);

	// Add levels
	const levels = taxonomy.levels ?? [];
	for (const level of levels) {
		await client.metadataTaxonomies.addMetadataTaxonomyLevel(
			namespace, taxonomy.key,
			{ displayName: level.displayName, description: level.description || undefined },
		);
	}

	// Add nodes in level order (parents before children)
	const nodes = taxonomy.nodes ?? [];
	const sortedNodes = [...nodes].sort((a, b) => a.level - b.level);

	// Map old IDs to new IDs for parent references
	const idMap = new Map<string, string>();

	for (const node of sortedNodes) {
		const parentId = node.parentId
			? idMap.get(node.parentId) ?? node.parentId
			: undefined;

		const created = await client.metadataTaxonomies.createMetadataTaxonomyNode(
			namespace, taxonomy.key,
			{
				displayName: node.displayName,
				level: node.level,
				parentId: parentId || undefined,
			},
		);
		if (node.id && created.id) {
			idMap.set(node.id, created.id);
		}
	}
}

async function updateExistingTaxonomy(
	client: BoxClient,
	namespace: string,
	taxonomyKey: string,
	desired: TaxonomyJson,
	existing: TaxonomyJson,
): Promise<void> {
	// Update display name if changed
	if (desired.displayName !== existing.displayName) {
		await client.metadataTaxonomies.updateMetadataTaxonomy(
			namespace, taxonomyKey,
			{ displayName: desired.displayName },
		);
	}

	// Sync levels — add missing levels
	const existingLevelCount = (existing.levels ?? []).length;
	const desiredLevels = desired.levels ?? [];

	// Update existing levels
	for (let i = 0; i < Math.min(existingLevelCount, desiredLevels.length); i++) {
		const existingLevel = existing.levels![i];
		const desiredLevel = desiredLevels[i];
		if (existingLevel.displayName !== desiredLevel.displayName ||
			(existingLevel.description ?? '') !== (desiredLevel.description ?? '')) {
			await client.metadataTaxonomies.updateMetadataTaxonomyLevelById(
				namespace, taxonomyKey, desiredLevel.level,
				{ displayName: desiredLevel.displayName, description: desiredLevel.description || undefined },
			);
		}
	}

	// Add new levels beyond existing count
	for (let i = existingLevelCount; i < desiredLevels.length; i++) {
		await client.metadataTaxonomies.addMetadataTaxonomyLevel(
			namespace, taxonomyKey,
			{ displayName: desiredLevels[i].displayName, description: desiredLevels[i].description || undefined },
		);
	}

	// Sync nodes
	const existingNodeMap = new Map((existing.nodes ?? []).map(n => [n.id!, n]));
	const desiredNodes = desired.nodes ?? [];
	const desiredNodeIds = new Set(desiredNodes.filter(n => n.id).map(n => n.id!));

	// Delete nodes that are no longer desired (children first — reverse level order)
	const nodesToDelete = [...existingNodeMap.values()]
		.filter(n => n.id && !desiredNodeIds.has(n.id))
		.sort((a, b) => b.level - a.level);

	for (const node of nodesToDelete) {
		try {
			await client.metadataTaxonomies.deleteMetadataTaxonomyNode(
				namespace, taxonomyKey, node.id!,
			);
		} catch {
			// Node may have already been deleted with parent
		}
	}

	// Update existing nodes
	for (const node of desiredNodes) {
		if (!node.id) { continue; }
		const existingNode = existingNodeMap.get(node.id);
		if (existingNode && existingNode.displayName !== node.displayName) {
			await client.metadataTaxonomies.updateMetadataTaxonomyNode(
				namespace, taxonomyKey, node.id,
				{ requestBody: { displayName: node.displayName } },
			);
		}
	}

	// Add new nodes (those without IDs or with IDs not in existing)
	const newNodes = desiredNodes
		.filter(n => !n.id || !existingNodeMap.has(n.id))
		.sort((a, b) => a.level - b.level);

	const idMap = new Map<string, string>();
	for (const node of newNodes) {
		const parentId = node.parentId
			? idMap.get(node.parentId) ?? node.parentId
			: undefined;

		const created = await client.metadataTaxonomies.createMetadataTaxonomyNode(
			namespace, taxonomyKey,
			{
				displayName: node.displayName,
				level: node.level,
				parentId: parentId || undefined,
			},
		);
		if (node.id && created.id) {
			idMap.set(node.id, created.id);
		}
	}
}
