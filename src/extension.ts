import * as vscode from 'vscode';
import { ext } from './extensionVariables';
import { CTX_DEBUG_RUNNING, updateAuthContext, updateProjectContext } from './utils/contextKeys';
import { closeActiveServer } from './utils/oauthServer';
import { registerCommands } from './commands/registerCommands';
import { registerViews } from './views/registerViews';
import { initStatusBar } from './statusBar/boxStatusBar';

export function activate(context: vscode.ExtensionContext): void {
	ext.context = context;
	ext.out     = vscode.window.createOutputChannel('Box');
	context.subscriptions.push(ext.out);

	// Status bar (must be created before updateAuthContext, which refreshes it)
	initStatusBar(context);

	// Set context keys immediately so command visibility is correct from the start
	void updateProjectContext();
	void updateAuthContext();
	void vscode.commands.executeCommand('setContext', CTX_DEBUG_RUNNING, true);

	// Watch for box-project.json creation / deletion so project.generated stays in sync
	const watcher = vscode.workspace.createFileSystemWatcher('**/box-project.json');
	watcher.onDidCreate(() => void updateProjectContext());
	watcher.onDidDelete(() => void updateProjectContext());
	context.subscriptions.push(watcher);

	// Register all commands
	context.subscriptions.push(...registerCommands());

	// Register all tree views
	context.subscriptions.push(...registerViews());
}

export function deactivate(): void {
	closeActiveServer();
}
