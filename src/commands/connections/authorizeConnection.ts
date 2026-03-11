import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { BoxClient, BoxOAuth, OAuthConfig } from 'box-node-sdk';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader, printKVTable } from '../../utils/output';
import { getConnectionAliases, storeConnection, BoxConnection } from '../../utils/connectionStorage';
import { updateAuthContext } from '../../utils/contextKeys';
import { waitForOAuthCallback } from '../../utils/oauthServer';

export async function authorizeConnection(): Promise<void> {
	const config            = vscode.workspace.getConfiguration('box');
	const savedClientId     = config.get<string>('clientId', '');
	const savedClientSecret = config.get<string>('clientSecret', '');
	const savedCallbackUrl  = config.get<string>('callbackUrl', 'http://localhost:3000/callback');

	// Step 1 — Alias
	const existingAliases = await getConnectionAliases();
	const aliasInput = await vscode.window.showInputBox({
		title: 'Box: Authorize Connection  (1 / 4)',
		prompt: 'Enter a unique alias to identify this connection',
		placeHolder: 'e.g. my-box-account',
		ignoreFocusOut: true,
		validateInput: v => {
			if (!v || !v.trim()) { return 'Alias cannot be empty'; }
			if (existingAliases.includes(v.trim())) { return `A connection named "${v.trim()}" already exists`; }
			return null;
		},
	});
	if (!aliasInput) { return; }

	// Step 2 — Client ID
	const clientIdInput = await vscode.window.showInputBox({
		title: 'Box: Authorize Connection  (2 / 4)',
		prompt: 'Enter your Box application Client ID',
		placeHolder: 'Client ID from the Box Developer Console',
		value: savedClientId,
		ignoreFocusOut: true,
		validateInput: v => (!v || !v.trim()) ? 'Client ID is required' : null,
	});
	if (!clientIdInput) { return; }

	// Step 3 — Client Secret
	const clientSecretInput = await vscode.window.showInputBox({
		title: 'Box: Authorize Connection  (3 / 4)',
		prompt: 'Enter your Box application Client Secret',
		placeHolder: 'Client Secret from the Box Developer Console',
		value: savedClientSecret,
		password: true,
		ignoreFocusOut: true,
		validateInput: v => (!v || !v.trim()) ? 'Client Secret is required' : null,
	});
	if (!clientSecretInput) { return; }

	// Step 4 — Full callback URL
	const callbackUrlInput = await vscode.window.showInputBox({
		title: 'Box: Authorize Connection  (4 / 4)',
		prompt: 'Enter the full OAuth 2.0 redirect URI — must match your Box app settings',
		placeHolder: 'http://localhost:3000/callback',
		value: savedCallbackUrl,
		ignoreFocusOut: true,
		validateInput: v => {
			if (!v || !v.trim()) { return 'Callback URL is required'; }
			try {
				const u = new URL(v.trim());
				if (u.protocol !== 'http:' && u.protocol !== 'https:') {
					return 'Must be an http:// or https:// URL';
				}
				return null;
			} catch {
				return 'Enter a valid URL (e.g. http://localhost:3000/callback)';
			}
		},
	});
	if (!callbackUrlInput) { return; }

	const alias        = aliasInput.trim();
	const clientId     = clientIdInput.trim();
	const clientSecret = clientSecretInput.trim();
	const callbackUrl  = callbackUrlInput.trim();

	const oauthState  = crypto.randomBytes(16).toString('hex');
	const oauthConfig = new OAuthConfig({ clientId, clientSecret });
	const auth        = new BoxOAuth({ config: oauthConfig });
	const authUrl     = auth.getAuthorizeUrl({ redirectUri: callbackUrl, state: oauthState });

	logCommandHeader(ext.out, 'Box: Authorize Connection');
	log(ext.out, `Alias:        ${alias}`);
	log(ext.out, `Redirect URI: ${callbackUrl}`);
	log(ext.out, 'Opening browser — please complete the authorization flow in the browser window.');
	await vscode.env.clipboard.writeText(authUrl);
	log(ext.out, 'Authorization URL copied to clipboard.');
	ext.out.show(true);

	try {
		const result = await waitForOAuthCallback(callbackUrl, authUrl, oauthState);

		let connection: BoxConnection;
		try {
			const token  = await auth.getTokensAuthorizationCodeGrant(result.code);
			const client = new BoxClient({ auth });
			const user   = await client.users.getUserMe({ fields: ['id', 'name', 'login', 'enterprise'] });

			const enterpriseId = user.enterprise?.id ?? '';

			connection = {
				alias,
				clientId,
				clientSecret,
				accessToken:  token.accessToken  ?? '',
				refreshToken: token.refreshToken ?? '',
				userId:    user.id,
				userName:  user.name  ?? '',
				userLogin: user.login ?? '',
				enterpriseId,
			};

			result.complete({
				userName: connection.userName,
				userLogin: connection.userLogin,
				userId: connection.userId,
				enterpriseId: connection.enterpriseId,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.fail(message);
			throw err;
		}

		await storeConnection(connection);

		const updatedAliases = await getConnectionAliases();
		const isFirst = updatedAliases.length === 1;
		if (isFirst) {
			await ext.context.globalState.update('box.defaultConnection', alias);
		}

		printKVTable(ext.out, 'Box Authorization Result', [
			['Status',        'Authorized'],
			['Alias',         connection.alias],
			['User ID',       connection.userId],
			['Name',          connection.userName],
			['Login',         connection.userLogin],
			['Enterprise ID', connection.enterpriseId || '(none)'],
		]);

		log(ext.out, isFirst
			? 'Connection saved and set as the default.'
			: 'Connection saved.');

		vscode.window.showInformationMessage(
			`Box connection "${connection.alias}" authorized as ${connection.userLogin}.`
			+ (isFirst ? '  Set as default connection.' : '')
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(`Box authorization error: ${message}`);
	} finally {
		await updateAuthContext();
	}
}
