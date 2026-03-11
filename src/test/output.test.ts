import * as assert from 'assert';
import { redactToken, timestamp, buildTable } from '../utils/output';

suite('Output Utilities', () => {
	suite('redactToken', () => {
		test('redacts long token keeping last 4 chars', () => {
			const result = redactToken('abcdefghijklmnop');
			assert.strictEqual(result, '************mnop');
		});

		test('redacts token of exactly 5 chars', () => {
			const result = redactToken('abcde');
			assert.strictEqual(result, '*bcde');
		});

		test('fully redacts token of 4 chars or fewer', () => {
			assert.strictEqual(redactToken('abcd'), '****');
			assert.strictEqual(redactToken('abc'), '****');
			assert.strictEqual(redactToken('a'), '****');
		});

		test('fully redacts empty string', () => {
			assert.strictEqual(redactToken(''), '****');
		});
	});

	suite('timestamp', () => {
		test('returns string in YYYY-MM-DD HH:MM:SS format', () => {
			const ts = timestamp();
			assert.match(ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		});
	});

	suite('buildTable', () => {
		test('builds table with title, headers, and rows', () => {
			const result = buildTable('Test', ['Col1', 'Col2'], [
				['Key1', 'Value1'],
				['Key2', 'Value2'],
			]);
			const text = result.join('\n');
			assert.ok(text.includes('Test'));
			assert.ok(text.includes('Key1'));
			assert.ok(text.includes('Value1'));
			assert.ok(text.includes('Col1'));
		});

		test('builds table without title', () => {
			const result = buildTable(null, ['A', 'B'], [['1', '2']]);
			const text = result.join('\n');
			assert.ok(text.includes('1'));
			assert.ok(text.includes('2'));
		});

		test('builds table without headers', () => {
			const result = buildTable('Title', null, [['a', 'b']]);
			const text = result.join('\n');
			assert.ok(text.includes('Title'));
			assert.ok(text.includes('a'));
		});

		test('handles empty rows', () => {
			const result = buildTable('Empty', null, []);
			assert.ok(Array.isArray(result));
		});

		test('aligns columns correctly for varying widths', () => {
			const result = buildTable(null, null, [
				['Short', 'A'],
				['Much Longer Key', 'B'],
			]);
			// Data rows should have the same line length (aligned by box-drawing)
			const dataLines = result.filter((l: string) => l.includes('│') && !l.includes('─'));
			if (dataLines.length >= 2) {
				assert.strictEqual(dataLines[0].length, dataLines[1].length);
			}
		});
	});
});
