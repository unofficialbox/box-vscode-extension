import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { logCommandHeader, printKVTable } from '../../utils/output';
import { getConnection } from '../../utils/connectionStorage';

export async function displayDefaultConnection(): Promise<void> {
	const defaultAlias = ext.context.globalState.get<string>('box.defaultConnection', '');

	if (!defaultAlias) {
		vscode.window.showInformationMessage('No default Box connection set. Use "Box: Set Default Connection" to set one.');
		return;
	}

	const conn = await getConnection(defaultAlias);
	if (!conn) {
		vscode.window.showErrorMessage(`Default connection "${defaultAlias}" not found.`);
		return;
	}

	logCommandHeader(ext.out, 'Box: Display the Default Box Connection');
	printKVTable(ext.out, 'Default Box Connection', [
		['Alias',         conn.alias],
		['Name',          conn.userName],
		['Login',         conn.userLogin],
		['ID',            conn.userId],
		['Enterprise ID', conn.enterpriseId || '(none)'],
	]);
	ext.out.show(true);

	vscode.window.showInformationMessage(
		`Default Box connection: "${conn.alias}"  (${conn.userLogin}).`
	);
}
