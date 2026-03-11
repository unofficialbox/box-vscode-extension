import * as assert from 'assert';

/**
 * Tests for the diff normalization logic used in diffPreview.ts.
 * We replicate the normalization functions here since they're private,
 * verifying the same algorithm produces correct results.
 */

function stripProperty(obj: unknown, key: string, value: unknown): void {
	if (Array.isArray(obj)) {
		for (const item of obj) { stripProperty(item, key, value); }
	} else if (obj !== null && typeof obj === 'object') {
		const record = obj as Record<string, unknown>;
		if (key in record && record[key] === value) {
			delete record[key];
		}
		for (const k of Object.keys(record)) {
			stripProperty(record[k], key, value);
		}
	}
}

function stripKey(obj: unknown, key: string): void {
	if (Array.isArray(obj)) {
		for (const item of obj) { stripKey(item, key); }
	} else if (obj !== null && typeof obj === 'object') {
		const record = obj as Record<string, unknown>;
		delete record[key];
		for (const k of Object.keys(record)) {
			stripKey(record[k], key);
		}
	}
}

function normalizeDiffJson(json: unknown, type: 'template' | 'taxonomy'): unknown {
	if (json === null || json === undefined) { return json; }
	const obj = JSON.parse(JSON.stringify(json));
	if (type === 'template') {
		stripProperty(obj, 'hidden', false);
		stripProperty(obj, 'description', '');
		stripKey(obj, 'scope');
	} else if (type === 'taxonomy') {
		stripKey(obj, 'namespace');
	}
	return obj;
}

suite('Diff Normalization', () => {
	suite('Template normalization', () => {
		test('removes hidden: false from top-level', () => {
			const input = { displayName: 'Test', hidden: false };
			const result = normalizeDiffJson(input, 'template') as Record<string, unknown>;
			assert.strictEqual('hidden' in result, false);
			assert.strictEqual(result.displayName, 'Test');
		});

		test('preserves hidden: true', () => {
			const input = { displayName: 'Test', hidden: true };
			const result = normalizeDiffJson(input, 'template') as Record<string, unknown>;
			assert.strictEqual(result.hidden, true);
		});

		test('removes hidden: false from nested fields array', () => {
			const input = {
				fields: [
					{ key: 'f1', hidden: false, type: 'string' },
					{ key: 'f2', hidden: true, type: 'string' },
				],
			};
			const result = normalizeDiffJson(input, 'template') as { fields: Array<Record<string, unknown>> };
			assert.strictEqual('hidden' in result.fields[0], false);
			assert.strictEqual(result.fields[1].hidden, true);
		});

		test('removes empty description', () => {
			const input = { displayName: 'Test', description: '' };
			const result = normalizeDiffJson(input, 'template') as Record<string, unknown>;
			assert.strictEqual('description' in result, false);
		});

		test('preserves non-empty description', () => {
			const input = { displayName: 'Test', description: 'A real description' };
			const result = normalizeDiffJson(input, 'template') as Record<string, unknown>;
			assert.strictEqual(result.description, 'A real description');
		});

		test('removes scope at all levels', () => {
			const input = { scope: 'enterprise_12345', fields: [{ key: 'f1', scope: 'enterprise_12345' }] };
			const result = normalizeDiffJson(input, 'template') as Record<string, unknown>;
			assert.strictEqual('scope' in result, false);
			assert.strictEqual('scope' in (result.fields as Array<Record<string, unknown>>)[0], false);
		});
	});

	suite('Taxonomy normalization', () => {
		test('removes namespace at all levels', () => {
			const input = {
				key: 'tax1',
				namespace: 'enterprise_12345',
				levels: [{ key: 'l1', namespace: 'enterprise_12345' }],
			};
			const result = normalizeDiffJson(input, 'taxonomy') as Record<string, unknown>;
			assert.strictEqual('namespace' in result, false);
			assert.strictEqual('namespace' in (result.levels as Array<Record<string, unknown>>)[0], false);
			assert.strictEqual(result.key, 'tax1');
		});

		test('does not remove hidden or scope from taxonomies', () => {
			const input = { key: 'tax1', hidden: false, scope: 'enterprise' };
			const result = normalizeDiffJson(input, 'taxonomy') as Record<string, unknown>;
			assert.strictEqual(result.hidden, false);
			assert.strictEqual(result.scope, 'enterprise');
		});
	});

	suite('Edge cases', () => {
		test('handles null input', () => {
			assert.strictEqual(normalizeDiffJson(null, 'template'), null);
		});

		test('handles undefined input', () => {
			assert.strictEqual(normalizeDiffJson(undefined, 'taxonomy'), undefined);
		});

		test('does not mutate original object', () => {
			const input = { hidden: false, scope: 'enterprise' };
			normalizeDiffJson(input, 'template');
			assert.strictEqual(input.hidden, false);
			assert.strictEqual(input.scope, 'enterprise');
		});
	});
});
