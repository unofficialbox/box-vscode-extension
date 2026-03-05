import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { log, logCommandHeader } from '../../utils/output';
import { BoxProject, ProjectTemplate, TEMPLATE_DIRS } from '../../utils/projectTemplates';
import { CTX_PROJECT_GENERATED } from '../../utils/contextKeys';

export async function createProject(): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('Open a workspace folder before creating a Box project.');
		return;
	}

	const projectUri = vscode.Uri.joinPath(workspaceFolder.uri, 'box-project.json');
	try {
		await vscode.workspace.fs.stat(projectUri);
		vscode.window.showWarningMessage('A Box project already exists in this workspace.');
		return;
	} catch {
		// Expected — file does not exist yet
	}

	// Step 1 — Select template
	const templateItems: vscode.QuickPickItem[] = [
		{
			label: 'Empty',
			description: 'box-project.json  +  metadata-templates/',
		},
		{
			label: 'Simple',
			description: 'Empty  +  folders/',
		},
		{
			label: 'Full',
			description: 'Simple  +  automate/, apps/, ai_agents/, sign/, hubs/, and more',
		},
	];

	const templatePick = await vscode.window.showQuickPick(templateItems, {
		title: 'Create Box Project  (1 / 2)  — Select Template',
		placeHolder: 'Choose a project template',
		ignoreFocusOut: true,
	});
	if (!templatePick) { return; }
	const template = templatePick.label as ProjectTemplate;

	// Step 2 — Project name
	const nameInput = await vscode.window.showInputBox({
		title: 'Create Box Project  (2 / 2)  — Project Name',
		prompt: 'Enter a name for this Box project',
		value: workspaceFolder.name,
		ignoreFocusOut: true,
		validateInput: v => (!v || !v.trim()) ? 'Project name cannot be empty' : null,
	});
	if (!nameInput) { return; }

	const project: BoxProject = {
		name: nameInput.trim(),
		template,
		created: new Date().toISOString(),
		version: '1.0.0',
	};

	// Write box-project.json
	const encoder = new TextEncoder();
	await vscode.workspace.fs.writeFile(
		projectUri,
		encoder.encode(JSON.stringify(project, null, 2))
	);

	// Scaffold template directories
	const root = workspaceFolder.uri;
	for (const dir of TEMPLATE_DIRS[template]) {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, dir));
	}

	await vscode.commands.executeCommand('setContext', CTX_PROJECT_GENERATED, true);

	logCommandHeader(ext.out, 'Box: Create Box Project');
	log(ext.out, `Project name: ${project.name}`);
	log(ext.out, `Template:     ${template}`);
	log(ext.out, 'Directories created:');
	for (const dir of TEMPLATE_DIRS[template]) {
		log(ext.out, `  ├─ ${dir}/`);
	}
	ext.out.show(true);

	vscode.window.showInformationMessage(
		`Box project "${project.name}" created (${template} template). You can now authorize a Box connection.`
	);
}
