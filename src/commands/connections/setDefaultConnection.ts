import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { getConnectionAliases, getConnection } from '../../utils/connectionStorage';
import { clearBoxClientCache } from '../../utils/boxClient';
import { updateStatusBar } from '../../statusBar/boxStatusBar';

export async function setDefaultConnection(): Promise<void> {
	const aliases = await getConnectionAliases();

	if (aliases.length === 0) {
		vscode.window.showInformationMessage('No Box connections found. Run "Box: Authorize Connection" to add one.');
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
		placeHolder: 'Select a connection to set as default',
	});
	if (!selected) { return; }

	await ext.context.globalState.update('box.defaultConnection', selected.label);
	clearBoxClientCache();
	await updateStatusBar(selected.label);

	logCommandHeader(ext.out, 'Box: Set the Default Box Connection');
	log(ext.out, `Default connection set to "${selected.label}".`);

	vscode.window.showInformationMessage(`Default Box connection set to "${selected.label}".`);
}
