import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getConnectionAliases } from '../../utils/connectionStorage';
import { CTX_PROJECT_GENERATED, CTX_BOX_AUTHENTICATED } from '../../utils/contextKeys';

export async function resetWorkspaceContext(): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		'Reset all Box workspace context? This will clear all stored connections and project settings.',
		{ modal: true },
		'Reset'
	);
	if (confirm !== 'Reset') { return; }

	// Delete all stored connection secrets
	const aliases = await getConnectionAliases();
	for (const alias of aliases) {
		await ext.context.secrets.delete(`box.connection.${alias}`);
	}

	// Clear global state
	await ext.context.globalState.update('box.connectionAliases', []);
	await ext.context.globalState.update('box.defaultConnection', '');

	// Reset context keys
	await vscode.commands.executeCommand('setContext', CTX_PROJECT_GENERATED, false);
	await vscode.commands.executeCommand('setContext', CTX_BOX_AUTHENTICATED, false);

	logCommandHeader(ext.out, 'Box: Reset Workspace Context');
	log(ext.out, `Cleared ${aliases.length} stored connection${aliases.length === 1 ? '' : 's'}.`);
	log(ext.out, 'Project context and authentication state have been reset.');
	ext.out.show(true);

	vscode.window.showInformationMessage('Box workspace context has been reset.');
}
