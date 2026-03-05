import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { log } from './output';
import { getConnectionAliases } from './connectionStorage';
import { updateStatusBar } from '../statusBar/boxStatusBar';

// ─── Constants ────────────────────────────────────────────────────────────────

export const CTX_PROJECT_GENERATED = 'project.generated';
export const CTX_BOX_AUTHENTICATED = 'box.authenticated';
export const CTX_DEBUG_RUNNING     = 'debug.running';

// ─── Updaters ─────────────────────────────────────────────────────────────────

export async function updateProjectContext(): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		log(ext.out, '[updateProjectContext] No workspace folder → project.generated=false');
		await vscode.commands.executeCommand('setContext', CTX_PROJECT_GENERATED, false);
		return;
	}
	const projectUri = vscode.Uri.joinPath(workspaceFolder.uri, 'box-project.json');
	try {
		await vscode.workspace.fs.stat(projectUri);
		log(ext.out, `[updateProjectContext] Found ${projectUri.fsPath} → project.generated=true`);
		await vscode.commands.executeCommand('setContext', CTX_PROJECT_GENERATED, true);
	} catch {
		log(ext.out, `[updateProjectContext] Not found ${projectUri.fsPath} → project.generated=false`);
		await vscode.commands.executeCommand('setContext', CTX_PROJECT_GENERATED, false);
	}
}

export async function updateAuthContext(): Promise<void> {
	const aliases = await getConnectionAliases();
	const authenticated = aliases.length > 0;
	log(ext.out, `[updateAuthContext] aliases=${JSON.stringify(aliases)} → box.authenticated=${authenticated}`);
	await vscode.commands.executeCommand('setContext', CTX_BOX_AUTHENTICATED, authenticated);
	await updateStatusBar();
}
