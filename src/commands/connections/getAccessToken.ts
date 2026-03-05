import * as https from 'https';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader, printKVTable, redactToken } from '../../utils/output';
import { getConnectionAliases, getConnection } from '../../utils/connectionStorage';

// ─── Token refresh ────────────────────────────────────────────────────────────

interface RefreshedToken {
	accessToken: string;
	refreshToken: string;
}

function refreshBoxToken(
	clientId: string,
	clientSecret: string,
	refreshToken: string
): Promise<RefreshedToken> {
	return new Promise((resolve, reject) => {
		const body = new URLSearchParams({
			grant_type:    'refresh_token',
			client_id:     clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
		}).toString();

		const req = https.request(
			{
				hostname: 'api.box.com',
				path:     '/oauth2/token',
				method:   'POST',
				headers:  {
					'Content-Type':   'application/x-www-form-urlencoded',
					'Content-Length': Buffer.byteLength(body),
				},
			},
			(res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
				res.on('end', () => {
					try {
						const json = JSON.parse(data) as Record<string, unknown>;
						if (res.statusCode !== 200) {
							const errDesc = String(json['error_description'] ?? json['error'] ?? `HTTP ${res.statusCode}`);
							reject(new Error(errDesc));
							return;
						}
						resolve({
							accessToken:  String(json['access_token']  ?? ''),
							refreshToken: String(json['refresh_token'] ?? refreshToken),
						});
					} catch (e) {
						reject(e);
					}
				});
			}
		);

		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

// ─── Command ──────────────────────────────────────────────────────────────────

export async function getAccessToken(): Promise<void> {
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
		placeHolder: 'Select a connection to retrieve the access token for',
	});
	if (!selected) { return; }

	const conn = await getConnection(selected.label);
	if (!conn) {
		vscode.window.showErrorMessage(`Connection "${selected.label}" not found.`);
		return;
	}

	logCommandHeader(ext.out, 'Box: Get Access Token');
	log(ext.out, `Refreshing token for connection "${conn.alias}"…`);
	ext.out.show(true);

	let accessToken: string;
	try {
		const refreshed = await refreshBoxToken(conn.clientId, conn.clientSecret, conn.refreshToken);
		accessToken = refreshed.accessToken;

		// Persist the updated tokens back to the secret store
		conn.accessToken  = accessToken;
		conn.refreshToken = refreshed.refreshToken;
		await ext.context.secrets.store(`box.connection.${conn.alias}`, JSON.stringify(conn));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log(ext.out, `Token refresh failed: ${msg}`);
		vscode.window.showErrorMessage(`Failed to refresh access token: ${msg}`);
		return;
	}

	printKVTable(ext.out, `Access Token  —  ${conn.alias}`, [
		['Alias',        conn.alias],
		['User',         `${conn.userName}  (${conn.userLogin})`],
		['Access Token', redactToken(accessToken)],
	]);

	await vscode.env.clipboard.writeText(accessToken);
	log(ext.out, 'Access token copied to clipboard.');

	vscode.window.showInformationMessage(
		`Access token for "${conn.alias}" copied to clipboard.`
	);
}
