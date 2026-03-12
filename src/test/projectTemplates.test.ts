import * as assert from 'assert';
import { TEMPLATE_DIRS, ProjectTemplate } from '../utils/projectTemplates';

suite('Project Templates', () => {
	test('defines two project types', () => {
		const types: ProjectTemplate[] = ['Blank', 'Standard'];
		for (const type of types) {
			assert.ok(TEMPLATE_DIRS[type] !== undefined, `Template "${type}" should exist`);
		}
	});

	test('Blank template has no directories', () => {
		const dirs = TEMPLATE_DIRS['Blank'];
		assert.strictEqual(dirs.length, 0, 'Blank should have no directories');
	});

	test('Standard template has metadata and folders directories', () => {
		const dirs = TEMPLATE_DIRS['Standard'];
		assert.ok(dirs.includes('metadata-templates'));
		assert.ok(dirs.includes('metadata-taxonomies'));
		assert.ok(dirs.includes('folders'));
		assert.ok(dirs.includes('enterprise_configuration'));
	});

	test('Standard template has more directories than Blank', () => {
		const blankDirs = TEMPLATE_DIRS['Blank'];
		const standardDirs = TEMPLATE_DIRS['Standard'];
		assert.ok(standardDirs.length > blankDirs.length, 'Standard should have more directories than Blank');
	});

	test('all template directories are non-empty strings', () => {
		for (const type of Object.keys(TEMPLATE_DIRS) as ProjectTemplate[]) {
			for (const dir of TEMPLATE_DIRS[type]) {
				assert.ok(typeof dir === 'string' && dir.trim().length > 0,
					`Directory in "${type}" should be a non-empty string, got "${dir}"`);
			}
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
