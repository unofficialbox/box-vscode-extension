import * as assert from 'assert';
import { TEMPLATE_DIRS, ProjectTemplate } from '../utils/projectTemplates';

suite('Project Templates', () => {
	test('defines three project types', () => {
		const types: ProjectTemplate[] = ['Minimal', 'Standard', 'Full'];
		for (const type of types) {
			assert.ok(TEMPLATE_DIRS[type], `Template "${type}" should exist`);
		}
	});

	test('Minimal template has metadata directories', () => {
		const dirs = TEMPLATE_DIRS['Minimal'];
		assert.ok(dirs.includes('metadata-templates'));
		assert.ok(dirs.includes('metadata-taxonomies'));
	});

	test('Full template has more directories than Standard', () => {
		const standardDirs = TEMPLATE_DIRS['Standard'];
		const fullDirs = TEMPLATE_DIRS['Full'];
		assert.ok(fullDirs.length > standardDirs.length, 'Full should have more directories than Standard');
	});

	test('Standard template has more directories than Minimal', () => {
		const minimalDirs = TEMPLATE_DIRS['Minimal'];
		const standardDirs = TEMPLATE_DIRS['Standard'];
		assert.ok(standardDirs.length > minimalDirs.length, 'Standard should have more directories than Minimal');
	});

	test('all template directories are non-empty strings', () => {
		for (const type of Object.keys(TEMPLATE_DIRS) as ProjectTemplate[]) {
			for (const dir of TEMPLATE_DIRS[type]) {
				assert.ok(typeof dir === 'string' && dir.trim().length > 0,
					`Directory in "${type}" should be a non-empty string, got "${dir}"`);
			}
		}
	});

	test('all templates include metadata-templates directory', () => {
		for (const type of Object.keys(TEMPLATE_DIRS) as ProjectTemplate[]) {
			assert.ok(TEMPLATE_DIRS[type].includes('metadata-templates'),
				`"${type}" should include metadata-templates`);
		}
	});

	test('no duplicate directories within a template', () => {
		for (const type of Object.keys(TEMPLATE_DIRS) as ProjectTemplate[]) {
			const dirs = TEMPLATE_DIRS[type];
			const unique = new Set(dirs);
			assert.strictEqual(dirs.length, unique.size,
				`"${type}" should not have duplicate directories`);
		}
	});
});
