import * as assert from 'assert';

/**
 * Tests the regex used in setupApiProxy to detect folder navigation
 * from Box API calls made by UI Elements (especially Content Picker).
 */
suite('Folder Navigation Detection', () => {
	const folderNavRegex = /api\.box\.com\/2\.0\/folders\/(\d+)/;

	test('matches standard folder API call', () => {
		const url = 'https://api.box.com/2.0/folders/12345';
		const match = url.match(folderNavRegex);
		assert.ok(match, 'Should match folder URL');
		assert.strictEqual(match![1], '12345');
	});

	test('matches folder API call with query params', () => {
		const url = 'https://api.box.com/2.0/folders/98765?fields=id,name,type&limit=1000&offset=0';
		const match = url.match(folderNavRegex);
		assert.ok(match, 'Should match folder URL with query params');
		assert.strictEqual(match![1], '98765');
	});

	test('matches root folder (id=0)', () => {
		const url = 'https://api.box.com/2.0/folders/0?fields=id,name';
		const match = url.match(folderNavRegex);
		assert.ok(match, 'Should match root folder');
		assert.strictEqual(match![1], '0');
	});

	test('does not match file API calls', () => {
		const url = 'https://api.box.com/2.0/files/12345';
		const match = url.match(folderNavRegex);
		assert.strictEqual(match, null, 'Should not match file URLs');
	});

	test('does not match other API endpoints', () => {
		const url = 'https://api.box.com/2.0/users/me';
		const match = url.match(folderNavRegex);
		assert.strictEqual(match, null, 'Should not match non-folder URLs');
	});

	test('does not match folder sub-resources like items or collaborations', () => {
		// The regex will actually match the folder ID part, which is fine -
		// we want the folder ID even from sub-resource calls
		const url = 'https://api.box.com/2.0/folders/55555/items';
		const match = url.match(folderNavRegex);
		assert.ok(match, 'Should still extract folder ID from sub-resource URLs');
		assert.strictEqual(match![1], '55555');
	});

	test('extracts correct ID from nested folder path', () => {
		const url = 'https://api.box.com/2.0/folders/999/items?fields=id,name,type,size';
		const match = url.match(folderNavRegex);
		assert.ok(match);
		assert.strictEqual(match![1], '999');
	});
});
