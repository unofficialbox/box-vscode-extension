import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getConnectionAliases, getConnection, deleteConnection } from '../../utils/connectionStorage';
import { updateAuthContext } from '../../utils/contextKeys';

export async function removeConnection(): Promise<void> {
	const aliases = await getConnectionAliases();

	if (aliases.length === 0) {
		vscode.window.showInformationMessage('No Box connections found.');
		return;
	}

	const defaultAlias = ext.context.globalState.get<string>('box.defaultConnection', '');

	const items: vscode.QuickPickItem[] = await Promise.all(
		aliases.map(async (alias) => {
			const conn = await getConnection(alias);
			return {
				label: alias,
				description: conn ? `${conn.userName}  (${conn.userLogin})` : '',
				detail: alias === defaultAlias ? '\u2605  Current default' : undefined,
			};
		})
	);

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a connection to remove',
	});
	if (!selected) { return; }

	const confirm = await vscode.window.showWarningMessage(
		`Remove Box connection "${selected.label}"?`,
		{ modal: true },
		'Remove'
	);
	if (confirm !== 'Remove') { return; }

	await deleteConnection(selected.label);
	await updateAuthContext();

	logCommandHeader(ext.out, 'Box: Remove Box Connection');
	log(ext.out, `Connection "${selected.label}" has been removed.`);

	vscode.window.showInformationMessage(`Box connection "${selected.label}" has been removed.`);
}
