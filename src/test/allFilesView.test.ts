import * as assert from 'assert';

/**
 * Tests for AllFilesView logic — deduplication, sorting, and filtering.
 * These test the pure algorithms without requiring VS Code API.
 */

interface MockItem {
	itemId: string;
	itemName: string;
	itemType: 'file' | 'folder' | 'web_link' | 'load_more';
}

/** Replicates the sorting logic from AllFilesProvider.fetchPage */
function sortItems(items: MockItem[]): MockItem[] {
	return [...items].sort((a, b) => {
		if (a.itemType === 'folder' && b.itemType !== 'folder') { return -1; }
		if (a.itemType !== 'folder' && b.itemType === 'folder') { return 1; }
		return a.itemName.localeCompare(b.itemName);
	});
}

/** Replicates the deduplication logic from AllFilesProvider.fetchPage */
function deduplicateItems(items: MockItem[]): MockItem[] {
	const seen = new Set<string>();
	return items.filter(i => {
		if (seen.has(i.itemId)) { return false; }
		seen.add(i.itemId);
		return true;
	});
}

/** Replicates the filter logic from AllFilesProvider.applyFilter */
function applyFilter(
	items: MockItem[],
	filterText: string,
	cache: Map<string, MockItem[]>,
): MockItem[] {
	const lower = filterText.toLowerCase();
	const filtered: MockItem[] = [];
	for (const item of items) {
		if (item.itemType === 'load_more') { continue; }
		const nameMatches = item.itemName.toLowerCase().includes(lower);
		if (item.itemType === 'folder') {
			if (nameMatches || hasMatchingDescendant(item.itemId, lower, cache)) {
				filtered.push(item);
			}
		} else if (nameMatches) {
			filtered.push(item);
		}
	}
	return filtered;
}

function hasMatchingDescendant(folderId: string, filterText: string, cache: Map<string, MockItem[]>): boolean {
	const children = cache.get(folderId);
	if (!children) { return false; }
	for (const child of children) {
		if (child.itemType === 'load_more') { continue; }
		if (child.itemName.toLowerCase().includes(filterText)) { return true; }
		if (child.itemType === 'folder' && hasMatchingDescendant(child.itemId, filterText, cache)) { return true; }
	}
	return false;
}

suite('All Files View Logic', () => {
	suite('Sorting', () => {
		test('folders come before files', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'readme.txt', itemType: 'file' },
				{ itemId: '2', itemName: 'docs', itemType: 'folder' },
			];
			const sorted = sortItems(items);
			assert.strictEqual(sorted[0].itemType, 'folder');
			assert.strictEqual(sorted[1].itemType, 'file');
		});

		test('items are sorted alphabetically within type groups', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'Zebra.txt', itemType: 'file' },
				{ itemId: '2', itemName: 'Alpha.txt', itemType: 'file' },
				{ itemId: '3', itemName: 'Zeta', itemType: 'folder' },
				{ itemId: '4', itemName: 'Bravo', itemType: 'folder' },
			];
			const sorted = sortItems(items);
			assert.strictEqual(sorted[0].itemName, 'Bravo');
			assert.strictEqual(sorted[1].itemName, 'Zeta');
			assert.strictEqual(sorted[2].itemName, 'Alpha.txt');
			assert.strictEqual(sorted[3].itemName, 'Zebra.txt');
		});

		test('handles empty array', () => {
			assert.deepStrictEqual(sortItems([]), []);
		});
	});

	suite('Deduplication', () => {
		test('removes duplicate items by ID', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'docs', itemType: 'folder' },
				{ itemId: '2', itemName: 'file.txt', itemType: 'file' },
				{ itemId: '1', itemName: 'docs', itemType: 'folder' },
			];
			const result = deduplicateItems(items);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].itemId, '1');
			assert.strictEqual(result[1].itemId, '2');
		});

		test('keeps first occurrence when duplicated', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'first', itemType: 'folder' },
				{ itemId: '1', itemName: 'second', itemType: 'folder' },
			];
			const result = deduplicateItems(items);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].itemName, 'first');
		});

		test('handles no duplicates', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'a', itemType: 'file' },
				{ itemId: '2', itemName: 'b', itemType: 'file' },
			];
			const result = deduplicateItems(items);
			assert.strictEqual(result.length, 2);
		});
	});

	suite('Filtering', () => {
		test('filters files by name (case-insensitive)', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'Report.pdf', itemType: 'file' },
				{ itemId: '2', itemName: 'Invoice.pdf', itemType: 'file' },
				{ itemId: '3', itemName: 'readme.txt', itemType: 'file' },
			];
			const result = applyFilter(items, 'report', new Map());
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].itemName, 'Report.pdf');
		});

		test('includes folders whose name matches', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'Documents', itemType: 'folder' },
				{ itemId: '2', itemName: 'Photos', itemType: 'folder' },
			];
			const result = applyFilter(items, 'doc', new Map());
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].itemName, 'Documents');
		});

		test('includes folders with matching cached descendants', () => {
			const cache = new Map<string, MockItem[]>();
			cache.set('1', [
				{ itemId: '10', itemName: 'target-file.txt', itemType: 'file' },
			]);

			const items: MockItem[] = [
				{ itemId: '1', itemName: 'Unrelated Folder', itemType: 'folder' },
				{ itemId: '2', itemName: 'Other Folder', itemType: 'folder' },
			];
			const result = applyFilter(items, 'target', cache);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].itemName, 'Unrelated Folder');
		});

		test('recursively checks nested cached descendants', () => {
			const cache = new Map<string, MockItem[]>();
			cache.set('1', [
				{ itemId: '10', itemName: 'Subfolder', itemType: 'folder' },
			]);
			cache.set('10', [
				{ itemId: '100', itemName: 'deep-match.pdf', itemType: 'file' },
			]);

			const items: MockItem[] = [
				{ itemId: '1', itemName: 'Top Folder', itemType: 'folder' },
			];
			const result = applyFilter(items, 'deep-match', cache);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].itemName, 'Top Folder');
		});

		test('excludes load_more items', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'file.txt', itemType: 'file' },
				{ itemId: 'lm', itemName: 'Load More…', itemType: 'load_more' },
			];
			const result = applyFilter(items, 'load', new Map());
			assert.strictEqual(result.length, 0);
		});

		test('returns no results when nothing matches', () => {
			const items: MockItem[] = [
				{ itemId: '1', itemName: 'document.pdf', itemType: 'file' },
			];
			const result = applyFilter(items, 'zzzzz', new Map());
			assert.strictEqual(result.length, 0);
		});
	});
});
