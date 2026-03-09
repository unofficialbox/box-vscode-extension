import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader, printKVTable } from '../../utils/output';
import { getBoxClient } from '../../utils/boxClient';

export async function createDevApp(): Promise<void> {
	const clientResult = await getBoxClient();
	if (!clientResult) {
		vscode.window.showErrorMessage('No default Box connection available. Please authorize a connection first.');
		return;
	}

	const nameInput = await vscode.window.showInputBox({
		title: 'Box: Create Developer Application',
		prompt: 'Enter a name for the new Box developer application',
		placeHolder: 'e.g. my-box-app',
		ignoreFocusOut: true,
		validateInput: v => (!v || !v.trim()) ? 'Application name is required' : null,
	});
	if (!nameInput) { return; }

	const appName = nameInput.trim();

	logCommandHeader(ext.out, 'Box: Create Developer Application');
	log(ext.out, `Creating application "${appName}"...`);
	ext.out.show(true);

	try {
		const token = await clientResult.auth.retrieveToken();
		const accessToken = token.accessToken;

		const response = await fetch('https://api.box.com/2.0/apps', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: appName,
				authentication_type: 'auth_client_credentials',
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(`${response.status} ${response.statusText}: ${errorBody}`);
		}

		const result = await response.json() as Record<string, unknown>;

		printKVTable(ext.out, 'Box Developer Application Created', [
			['App Name', String(result.name ?? appName)],
			['App ID', String(result.id ?? 'N/A')],
			['Client ID', String(result.client_id ?? 'N/A')],
			['Auth Type', String(result.authentication_type ?? 'N/A')],
		]);

		log(ext.out, 'Application details printed above.');

		vscode.window.showInformationMessage(
			`Box developer application "${appName}" created — details are in the Box output channel.`
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[CreateDevApp] Failed: ${message}`);
		vscode.window.showErrorMessage(`Failed to create Box application: ${message}`);
	}
}
