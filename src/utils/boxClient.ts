import { BoxClient, BoxOAuth, OAuthConfig } from 'box-node-sdk';
import { TokenStorage } from 'box-node-sdk/lib/box/tokenStorage';
import { AccessToken } from 'box-node-sdk/lib/schemas/accessToken';
import { ext } from '../extensionVariables';
import { log } from './output';
import { getConnection, storeConnection } from './connectionStorage';

// ─── Token storage that persists back to VS Code secrets ─────────────────────

class ConnectionTokenStorage implements TokenStorage {
	private token?: AccessToken;

	constructor(private readonly alias: string) {}

	async store(token: AccessToken): Promise<undefined> {
		this.token = token;

		// Persist refreshed tokens back to the connection store
		const conn = await getConnection(this.alias);
		if (conn && token.accessToken) {
			conn.accessToken = token.accessToken;
			if (token.refreshToken) {
				conn.refreshToken = token.refreshToken;
			}
			await storeConnection(conn);
		}

		return undefined;
	}

	async get(): Promise<AccessToken | undefined> {
		return this.token;
	}

	async clear(): Promise<undefined> {
		this.token = undefined;
		return undefined;
	}
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface BoxClientResult {
	client: BoxClient;
	auth: BoxOAuth;
}

// ─── Cached client ───────────────────────────────────────────────────────────

let cachedAlias: string | undefined;
let cachedResult: BoxClientResult | undefined;
let tokenExpiresAt = 0;

/** Box access tokens last 60 minutes. Refresh with a 5-minute safety margin. */
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

/**
 * Clears the cached client, forcing a fresh token refresh on the next call.
 * Call this when the default connection changes or a connection is removed.
 */
export function clearBoxClientCache(): void {
	cachedAlias = undefined;
	cachedResult = undefined;
	tokenExpiresAt = 0;
}

// ─── Client factory ──────────────────────────────────────────────────────────

/**
 * Creates a BoxClient using the default stored connection's OAuth credentials.
 * Caches the client and only refreshes the token when it is expired or about
 * to expire. Returns `undefined` if no default connection is set.
 */
export async function getBoxClient(): Promise<BoxClientResult | undefined> {
	const alias = ext.context.globalState.get<string>('box.defaultConnection', '');
	if (!alias) { return undefined; }

	// Return cached client if the token is still valid and alias hasn't changed
	if (cachedResult && cachedAlias === alias && Date.now() < tokenExpiresAt) {
		return cachedResult;
	}

	const conn = await getConnection(alias);
	if (!conn) { return undefined; }

	const tokenStorage = new ConnectionTokenStorage(alias);
	await tokenStorage.store({
		accessToken: conn.accessToken,
		refreshToken: conn.refreshToken,
	});

	const oauthConfig = new OAuthConfig({
		clientId: conn.clientId,
		clientSecret: conn.clientSecret,
		tokenStorage,
	});

	const auth = new BoxOAuth({ config: oauthConfig });

	try {
		await auth.refreshToken();
		log(ext.out, `[BoxClient] Token refreshed for "${alias}".`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[BoxClient] Token refresh failed for "${alias}": ${message}`);
		// Clear cache so the next call retries
		clearBoxClientCache();
		return undefined;
	}

	cachedAlias = alias;
	cachedResult = { client: new BoxClient({ auth }), auth };
	tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;

	return cachedResult;
}

/**
 * Creates a BoxClient for a specific connection alias (not cached).
 * Used for deploying to a target enterprise that may differ from the default.
 * Clears the module-level cache to prevent SDK-level token interference,
 * and verifies the resulting token belongs to the expected enterprise.
 */
export async function getBoxClientForAlias(alias: string): Promise<BoxClientResult | undefined> {
	const conn = await getConnection(alias);
	if (!conn) { return undefined; }

	// Clear any cached default client to prevent SDK-level token sharing
	clearBoxClientCache();

	const tokenStorage = new ConnectionTokenStorage(alias);
	await tokenStorage.store({
		accessToken: conn.accessToken,
		refreshToken: conn.refreshToken,
	});

	const oauthConfig = new OAuthConfig({
		clientId: conn.clientId,
		clientSecret: conn.clientSecret,
		tokenStorage,
	});

	const auth = new BoxOAuth({ config: oauthConfig });

	try {
		await auth.refreshToken();
		log(ext.out, `[BoxClient] Token refreshed for "${alias}".`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[BoxClient] Token refresh failed for "${alias}": ${message}`);
		return undefined;
	}

	const client = new BoxClient({ auth });

	// Verify the token belongs to the expected connection
	try {
		const user = await client.users.getUserMe();
		const tokenEnterprise = user.enterprise?.id ?? '';
		log(ext.out, `[BoxClient] Verified token for "${alias}": user=${user.login}, enterprise=${tokenEnterprise}`);

		if (conn.enterpriseId && tokenEnterprise && tokenEnterprise !== conn.enterpriseId) {
			log(ext.out, `[BoxClient] WARNING: Token enterprise "${tokenEnterprise}" does not match expected "${conn.enterpriseId}" for "${alias}".`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(ext.out, `[BoxClient] Token verification failed for "${alias}": ${message}`);
		return undefined;
	}

	return { client, auth };
}
