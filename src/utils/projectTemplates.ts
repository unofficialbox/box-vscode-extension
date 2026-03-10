// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectTemplate = 'Minimal' | 'Standard' | 'Full';

export interface BoxProject {
	name: string;
	template: string;
	created: string;
	version: string;
}

// ─── Template directory definitions ───────────────────────────────────────────

export const TEMPLATE_DIRS: Record<ProjectTemplate, string[]> = {
	'Minimal': [
		'metadata-templates',
		'metadata-taxonomies',
	],
	'Standard': [
		'metadata-templates',
		'metadata-taxonomies',
		'folders',
		'enterprise_configuration',

	],
	'Full': [
		'metadata-templates',
		'metadata-taxonomies',	
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
