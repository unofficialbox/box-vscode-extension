import { ext } from '../extensionVariables';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BoxConnection {
	alias: string;
	clientId: string;
	clientSecret: string;
	accessToken: string;
	refreshToken: string;
	userId: string;
	userName: string;
	userLogin: string;
	enterpriseId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function getConnectionAliases(): Promise<string[]> {
	return ext.context.globalState.get<string[]>('box.connectionAliases', []);
}

export async function getConnection(alias: string): Promise<BoxConnection | undefined> {
	const data = await ext.context.secrets.get(`box.connection.${alias}`);
	if (!data) { return undefined; }
	return JSON.parse(data) as BoxConnection;
}

export async function storeConnection(connection: BoxConnection): Promise<void> {
	const aliases = await getConnectionAliases();
	if (!aliases.includes(connection.alias)) {
		aliases.push(connection.alias);
		await ext.context.globalState.update('box.connectionAliases', aliases);
	}
	await ext.context.secrets.store(`box.connection.${connection.alias}`, JSON.stringify(connection));
}

export async function deleteConnection(alias: string): Promise<void> {
	const aliases = await getConnectionAliases();
	const updated = aliases.filter(a => a !== alias);
	await ext.context.globalState.update('box.connectionAliases', updated);
	await ext.context.secrets.delete(`box.connection.${alias}`);

	const defaultAlias = ext.context.globalState.get<string>('box.defaultConnection', '');
	if (defaultAlias === alias) {
		await ext.context.globalState.update(
			'box.defaultConnection',
			updated.length > 0 ? updated[0] : ''
		);
	}
}
