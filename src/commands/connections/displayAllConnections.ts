import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader, printTable } from '../../utils/output';
import { getConnectionAliases, getConnection, BoxConnection } from '../../utils/connectionStorage';

export async function displayAllConnections(): Promise<void> {
	const aliases      = await getConnectionAliases();
	const defaultAlias = ext.context.globalState.get<string>('box.defaultConnection', '');

	if (aliases.length === 0) {
		vscode.window.showInformationMessage('No Box connections found. Run "Box: Authorize Connection" to add one.');
		return;
	}

	const connections = (
		await Promise.all(aliases.map(a => getConnection(a)))
	).filter(Boolean) as BoxConnection[];

	const rows = connections.map(c => [
		c.alias === defaultAlias ? `${c.alias} \u2605` : c.alias,
		c.userName,
		c.userLogin,
		c.userId,
		c.enterpriseId || '(none)',
	]);

	logCommandHeader(ext.out, 'Box: Display All Box Connections');
	log(ext.out, `Found ${connections.length} connection${connections.length === 1 ? '' : 's'}.`);
	printTable(
		ext.out,
		`All Box Connections  (${connections.length})`,
		['Alias', 'Name', 'Login', 'ID', 'Enterprise ID'],
		rows
	);
	ext.out.show(true);

	vscode.window.showInformationMessage(
		`${connections.length} Box connection${connections.length === 1 ? '' : 's'} found.` +
		(defaultAlias ? `  Default: "${defaultAlias}".` : '  No default set.')
	);
}
