// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectTemplate = 'Empty' | 'Simple' | 'Full';

export interface BoxProject {
	name: string;
	template: string;
	created: string;
	version: string;
}

// ─── Template directory definitions ───────────────────────────────────────────

export const TEMPLATE_DIRS: Record<ProjectTemplate, string[]> = {
	'Empty': [
		'metadata-templates',
	],
	'Simple': [
		'metadata-templates',
		'folders',
	],
	'Full': [
		'metadata-templates',
		'folders',
		'automate',
		'automate/extract',
		'automate/workflows',
		'automate/docgen',
		'automate/forms',
		'apps',
		'ai_agents',
		'sign',
		'hubs',
		'enterprise_configuration',
		'dev_app_configurations',
		'shield',
	],
};
