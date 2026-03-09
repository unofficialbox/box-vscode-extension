import * as vscode from 'vscode';
import { createProject }            from './project/createProject';
import { resetWorkspaceContext }    from './project/resetWorkspaceContext';
import { authorizeConnection }      from './connections/authorizeConnection';
import { displayAllConnections }    from './connections/displayAllConnections';
import { displayDefaultConnection } from './connections/displayDefaultConnection';
import { setDefaultConnection }     from './connections/setDefaultConnection';
import { removeConnection }         from './connections/removeConnection';
import { getAccessToken }           from './connections/getAccessToken';
import { createDevApp }             from './devApp/createDevApp';
import { deployToCurrentEnterprise, deployToTargetEnterprise } from './deploy/deployMetadata';
import { diffAndDeployToDefaultEnterprise, diffAndDeployToTargetEnterprise } from './deploy/diffAndDeploy';

/** Registers all extension commands and returns their disposables. */
export function registerCommands(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('box-vscode-extension.createProject',            createProject),
		vscode.commands.registerCommand('box-vscode-extension.resetWorkspaceContext',    resetWorkspaceContext),
		vscode.commands.registerCommand('box-vscode-extension.authorize',                authorizeConnection),
		vscode.commands.registerCommand('box-vscode-extension.displayAllConnections',    displayAllConnections),
		vscode.commands.registerCommand('box-vscode-extension.displayDefaultConnection', displayDefaultConnection),
		vscode.commands.registerCommand('box-vscode-extension.setDefaultConnection',     setDefaultConnection),
		vscode.commands.registerCommand('box-vscode-extension.removeConnection',         removeConnection),
		vscode.commands.registerCommand('box-vscode-extension.getAccessToken',           getAccessToken),
		vscode.commands.registerCommand('box-vscode-extension.createDevApp',             createDevApp),
		vscode.commands.registerCommand('box-vscode-extension.deployToCurrentEnterprise',          deployToCurrentEnterprise),
		vscode.commands.registerCommand('box-vscode-extension.deployToTargetEnterprise',           deployToTargetEnterprise),
		vscode.commands.registerCommand('box-vscode-extension.diffAndDeployToDefaultEnterprise',   diffAndDeployToDefaultEnterprise),
		vscode.commands.registerCommand('box-vscode-extension.diffAndDeployToTargetEnterprise',    diffAndDeployToTargetEnterprise),
	];
}
