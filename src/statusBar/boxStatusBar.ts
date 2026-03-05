import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { log } from '../utils/output';
import { getConnectionAliases, getConnection } from '../utils/connectionStorage';

// ─── Status bar item ─────────────────────────────────────────────────────────

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Creates the Box status bar item and registers its click command.
 * Call once during activation.
 */
export function initStatusBar(context: vscode.ExtensionContext): void {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'box-vscode-extension.showConnectionStatus';
	context.subscriptions.push(statusBarItem);

	context.subscriptions.push(
		vscode.commands.registerCommand('box-vscode-extension.showConnectionStatus', showConnectionStatus)
	);
}

/**
 * Refreshes the status bar text and visibility based on stored connections.
 * Pass `defaultAlias` explicitly when the caller just wrote it to globalState
 * to avoid reading a stale value.  Safe to call before initStatusBar — no-ops.
 */
export async function updateStatusBar(defaultAlias?: string): Promise<void> {
	if (!statusBarItem) { return; }

	const aliases = await getConnectionAliases();
	if (aliases.length === 0) {
		statusBarItem.hide();
		return;
	}

	const resolvedAlias = defaultAlias ?? ext.context.globalState.get<string>('box.defaultConnection', '');
	const conn = resolvedAlias ? await getConnection(resolvedAlias) : undefined;

	log(ext.out, `[updateStatusBar] defaultAlias param="${defaultAlias}" → resolvedAlias="${resolvedAlias}"`);
	log(ext.out, `[updateStatusBar] conn=${conn ? JSON.stringify({ alias: conn.alias, userName: conn.userName, userLogin: conn.userLogin }) : 'undefined'}`);

	if (conn) {
		statusBarItem.text = `$(cloud) Box: ${conn.alias} (${conn.userLogin})`;
		const enterpriseInfo = conn.enterpriseId ? `\nEnterprise ID: ${conn.enterpriseId}` : '';
		statusBarItem.tooltip = `Box \u2014 ${conn.userName} (${conn.userLogin})${enterpriseInfo}`;
		log(ext.out, `[updateStatusBar] text set to "Box: ${conn.alias}"`);
	} else {
		statusBarItem.text = `$(cloud) Box`;
		statusBarItem.tooltip = `Box \u2014 ${aliases.length} connection${aliases.length === 1 ? '' : 's'}`;
	}

	statusBarItem.show();
}

// ─── Click handler (QuickPick panel) ─────────────────────────────────────────

interface ActionItem extends vscode.QuickPickItem {
	action?: string;
}

async function showConnectionStatus(): Promise<void> {
	const aliases = await getConnectionAliases();
	const defaultAlias = ext.context.globalState.get<string>('box.defaultConnection', '');

	const items: ActionItem[] = [];

	// ── Default connection info ──────────────────────────────────────────────
	if (defaultAlias) {
		const conn = await getConnection(defaultAlias);
		if (conn) {
			const enterpriseDetail = conn.enterpriseId ? `  \u2022  Enterprise ID: ${conn.enterpriseId}` : '';
			items.push({
				label: `$(person) ${conn.alias}`,
				description: `${conn.userName}  (${conn.userLogin})`,
				detail: `\u2605  Default connection  \u2022  User ID: ${conn.userId}${enterpriseDetail}`,
			});
		}
	}

	// ── Connection count ─────────────────────────────────────────────────────
	items.push({
		label: `$(plug) ${aliases.length} Connection${aliases.length === 1 ? '' : 's'}`,
		description: aliases.join(', '),
	});

	// ── Separator ────────────────────────────────────────────────────────────
	items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

	// ── Actions ──────────────────────────────────────────────────────────────
	items.push({
		label: '$(add) Authorize New Connection',
		action: 'box-vscode-extension.authorize',
	});

	if (aliases.length > 1) {
		items.push({
			label: '$(settings-gear) Set Default Connection',
			action: 'box-vscode-extension.setDefaultConnection',
		});
	}

	items.push({
		label: '$(key) Get Access Token',
		action: 'box-vscode-extension.getAccessToken',
	});

	items.push({
		label: '$(trash) Remove Connection',
		action: 'box-vscode-extension.removeConnection',
	});

	// ── Show ─────────────────────────────────────────────────────────────────
	const selected = await vscode.window.showQuickPick(items, {
		title: 'Box Connection Status',
		placeHolder: 'Select an action',
	});

	if (selected?.action) {
		await vscode.commands.executeCommand(selected.action);
	}
}
