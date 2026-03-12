import * as vscode from 'vscode';
import { diffAndDeployToDefaultEnterprise, diffAndDeployToTargetEnterprise } from './diffAndDeploy';
import { uploadFoldersToDefault, uploadFoldersToTarget } from '../files/uploadItems';

// ─── Unified deploy commands ────────────────────────────────────────────────
//
// These two commands replace all separate deploy/diff-deploy/upload commands
// with context-aware dispatch based on the project folder the user invoked
// the command from.

/**
 * Detects whether the given URI is inside `folders/` or `metadata-*` dirs
 * and dispatches to the appropriate deploy flow.
 */
function detectContext(uri: vscode.Uri): 'folders' | 'metadata' | null {
	const fsPath = uri.fsPath;

	// Check if inside folders/ directory
	if (/[/\\]folders([/\\]|$)/.test(fsPath) || fsPath.endsWith('/folders') || fsPath.endsWith('\\folders')) {
		return 'folders';
	}

	// Check if inside metadata-templates or metadata-taxonomies
	if (/metadata-templates|metadata-taxonomies/.test(fsPath)) {
		return 'metadata';
	}

	return null;
}

export async function deployToDefaultEnterprise(uri?: vscode.Uri): Promise<void> {
	if (uri) {
		const context = detectContext(uri);
		if (context === 'folders') {
			return uploadFoldersToDefault();
		}
		if (context === 'metadata') {
			return diffAndDeployToDefaultEnterprise(uri);
		}
	}

	// Called from command palette — ask user what to deploy
	const choice = await vscode.window.showQuickPick(
		[
			{ label: 'Metadata Templates & Taxonomies', value: 'metadata' },
			{ label: 'Folders & Files', value: 'folders' },
		],
		{ placeHolder: 'What would you like to deploy?', title: 'Deploy to Default Box Enterprise' },
	);
	if (!choice) { return; }

	if (choice.value === 'folders') {
		return uploadFoldersToDefault();
	}
	return diffAndDeployToDefaultEnterprise();
}

export async function deployToTargetEnterprise(uri?: vscode.Uri): Promise<void> {
	if (uri) {
		const context = detectContext(uri);
		if (context === 'folders') {
			return uploadFoldersToTarget();
		}
		if (context === 'metadata') {
			return diffAndDeployToTargetEnterprise(uri);
		}
	}

	// Called from command palette — ask user what to deploy
	const choice = await vscode.window.showQuickPick(
		[
			{ label: 'Metadata Templates & Taxonomies', value: 'metadata' },
			{ label: 'Folders & Files', value: 'folders' },
		],
		{ placeHolder: 'What would you like to deploy?', title: 'Deploy to Target Box Enterprise' },
	);
	if (!choice) { return; }

	if (choice.value === 'folders') {
		return uploadFoldersToTarget();
	}
	return diffAndDeployToTargetEnterprise();
}
