import * as vscode from 'vscode';
import { BoxOAuth, OAuthConfig } from 'box-node-sdk';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader, printKVTable, redactToken } from '../../utils/output';
import { waitForOAuthCallback } from '../../utils/oauthServer';

export async function createDevApp(): Promise<void> {
	const config            = vscode.workspace.getConfiguration('box');
	const savedClientId     = config.get<string>('clientId', '');
	const savedClientSecret = config.get<string>('clientSecret', '');
	const savedCallbackUrl  = config.get<string>('callbackUrl', 'http://localhost:3000/callback');

	// Step 1 — Client ID
	const clientIdInput = await vscode.window.showInputBox({
		title: 'Box: Create Developer App  (1 / 3)',
		prompt: 'Enter your Box application Client ID',
		placeHolder: 'Client ID from the Box Developer Console',
		value: savedClientId,
		ignoreFocusOut: true,
		validateInput: v => (!v || !v.trim()) ? 'Client ID is required' : null,
	});
	if (!clientIdInput) { return; }

	// Step 2 — Client Secret
	const clientSecretInput = await vscode.window.showInputBox({
		title: 'Box: Create Developer App  (2 / 3)',
		prompt: 'Enter your Box application Client Secret',
		placeHolder: 'Client Secret from the Box Developer Console',
		value: savedClientSecret,
		password: true,
		ignoreFocusOut: true,
		validateInput: v => (!v || !v.trim()) ? 'Client Secret is required' : null,
	});
	if (!clientSecretInput) { return; }

	// Step 3 — Full callback URL
	const callbackUrlInput = await vscode.window.showInputBox({
		title: 'Box: Create Developer App  (3 / 3)',
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

	const clientId     = clientIdInput.trim();
	const clientSecret = clientSecretInput.trim();
	const callbackUrl  = callbackUrlInput.trim();

	const oauthConfig = new OAuthConfig({ clientId, clientSecret });
	const auth        = new BoxOAuth({ config: oauthConfig });
	const authUrl     = auth.getAuthorizeUrl({ redirectUri: callbackUrl });

	logCommandHeader(ext.out, 'Box: Create Developer App');
	log(ext.out, `Redirect URI: ${callbackUrl}`);
	log(ext.out, 'Opening browser — please complete the authorization flow in the browser window.');
	ext.out.show(true);

	try {
		const result = await waitForOAuthCallback(callbackUrl, authUrl);
		const token = await auth.getTokensAuthorizationCodeGrant(result.code);
		result.complete({ userName: '', userLogin: '', userId: '', enterpriseId: '' });

		const accessToken  = token.accessToken  ?? '';
		const refreshToken = token.refreshToken ?? '';
		const expiresIn    = token.expiresIn;
		const tokenType    = token.tokenType ?? 'bearer';

		printKVTable(ext.out, 'Box Developer App Token', [
			['Access Token',  redactToken(accessToken)],
			['Refresh Token', redactToken(refreshToken)],
			['Token Type',    tokenType],
			['Expires In',    expiresIn !== undefined ? `${expiresIn} seconds` : 'N/A'],
		]);

		log(ext.out, 'Token details printed above. Use these credentials to authenticate with the Box API.');

		vscode.window.showInformationMessage(
			'Box Developer App authorized — token details are in the Box output channel.'
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(`Box authorization error: ${message}`);
	}
}
