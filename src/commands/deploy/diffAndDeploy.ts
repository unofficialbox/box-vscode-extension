import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getBoxClientForAlias, BoxClientResult } from '../../utils/boxClient';
import { getConnectionAliases, getConnection } from '../../utils/connectionStorage';
import {
	TemplateJson, TaxonomyJson,
	promptForDeployTarget, getDirContext, isTemplateJson, isTaxonomyJson,
	findExistingTemplate, findExistingTaxonomy,
	deployTemplate, deployTaxonomy,
} from './deployMetadata';
import { openDiffPreview, DiffItem } from '../../webview/diffPreview';

// ─── Public commands ────────────────────────────────────────────────────────

export async function diffAndDeployToDefaultEnterprise(uri?: vscode.Uri): Promise<void> {
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

	await buildAndShowDiff(resolved, result, alias, enterpriseId);
}

export async function diffAndDeployToTargetEnterprise(uri?: vscode.Uri): Promise<void> {
	const resolved = uri ?? await promptForDeployTarget();
	if (!resolved) { return; }

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
		placeHolder: 'Select a Box connection to diff and deploy to',
		title: 'Diff and Deploy to Target Box Enterprise',
	});
	if (!selected) { return; }

	const result = await getBoxClientForAlias(selected.label);
	if (!result) {
		vscode.window.showErrorMessage(`Failed to connect to Box using "${selected.label}".`);
		return;
	}

	const conn = await getConnection(selected.label);
	const enterpriseId = conn?.enterpriseId ?? '';

	await buildAndShowDiff(resolved, result, selected.label, enterpriseId);
}

// ─── Build diff items and open webview ──────────────────────────────────────

async function buildAndShowDiff(
	uri: vscode.Uri,
	clientResult: BoxClientResult,
	alias: string,
	enterpriseId: string,
): Promise<void> {
	logCommandHeader(ext.out, `Diff and Deploy to Box Enterprise (${alias})`);

	const stat = await vscode.workspace.fs.stat(uri);
	const files: vscode.Uri[] = [];

	if (stat.type === vscode.FileType.Directory) {
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
		vscode.window.showWarningMessage('No JSON files found to diff.');
		return;
	}

	const dirName = getDirContext(uri, stat.type);
	const diffItems: DiffItem[] = [];

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Fetching remote state from ${alias}`,
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
					const localJson = JSON.parse(content);

					if (dirName === 'metadata-templates' || isTemplateJson(localJson)) {
						const template = localJson as TemplateJson;
						const scope = template.scope === 'global' ? 'global' : 'enterprise';
						const remoteJson = await findExistingTemplate(
							clientResult.client, scope, template.templateKey,
						);
						diffItems.push({
							fileName,
							localJson: sortKeys(localJson),
							remoteJson: remoteJson ? sortKeys(remoteJson) : null,
							type: 'template',
						});
					} else if (dirName === 'metadata-taxonomies' || isTaxonomyJson(localJson)) {
						const taxonomy = localJson as TaxonomyJson;
						const namespace = enterpriseId ? `enterprise_${enterpriseId}` : taxonomy.namespace || '';
						const remoteJson = namespace
							? await findExistingTaxonomy(clientResult.client, namespace, taxonomy.key)
							: null;
						// Strip namespace from both sides since it's enterprise-specific
						const localNormalized = sortKeys({ ...localJson, namespace: undefined });
						const remoteNormalized = remoteJson ? sortKeys({ ...remoteJson, namespace: undefined }) : null;
						diffItems.push({
							fileName,
							localJson: localNormalized,
							remoteJson: remoteNormalized,
							type: 'taxonomy',
						});
					} else {
						log(ext.out, `[DiffDeploy] Skipping "${fileName}": not a template or taxonomy.`);
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					log(ext.out, `[DiffDeploy] Failed to process "${fileName}": ${message}`);
				}
			}
		},
	);

	if (diffItems.length === 0) {
		vscode.window.showWarningMessage('No deployable files found.');
		return;
	}

	openDiffPreview(diffItems, clientResult, alias, enterpriseId);
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Recursively sort object keys for stable diffs. */
function sortKeys(obj: unknown): unknown {
	if (obj === null || obj === undefined || typeof obj !== 'object') {
		return obj;
	}
	if (Array.isArray(obj)) {
		return obj.map(sortKeys);
	}
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
		sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
	}
	return sorted;
}
