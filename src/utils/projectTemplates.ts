// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectTemplate = 'Blank' | 'Standard';

export interface BoxProject {
	name: string;
	template: string;
	created: string;
	version: string;
}

// ─── Template directory definitions ───────────────────────────────────────────

export const TEMPLATE_DIRS: Record<ProjectTemplate, string[]> = {
	'Blank': [],
	'Standard': [
		'enterprise_configuration',
		'folders',
		'metadata-taxonomies',
		'metadata-templates',
	],
};
