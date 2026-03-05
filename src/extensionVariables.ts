import * as vscode from 'vscode';

/**
 * Singleton namespace that holds all shared extension state.
 * Initialized in activate() before any command runs.
 * Import `ext` from here instead of passing context/channel through params.
 */
export namespace ext {
	export let context: vscode.ExtensionContext;
	export let out: vscode.OutputChannel;
}
