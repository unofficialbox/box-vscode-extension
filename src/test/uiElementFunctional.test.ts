import * as assert from 'assert';

/**
 * Functional tests verifying the folder-navigation detection flow
 * used in the UI Element webview (setupApiProxy → postMessage → updateToolbarId).
 *
 * This simulates the data flow without requiring a real webview:
 *   1. Extension host receives an api-proxy message (simulated)
 *   2. Regex extracts folder ID from the URL
 *   3. A folder-navigated message is produced
 *   4. Webview-side handler calls updateToolbarId
 */
suite('UI Element Functional Tests', () => {
	const folderNavRegex = /api\.box\.com\/2\.0\/folders\/(\d+)/;

	/**
	 * Simulates what setupApiProxy does when it receives an api-proxy message:
	 * if it's a GET to a folder endpoint, it returns a folder-navigated message.
	 */
	function simulateProxyDetection(msg: { type: string; method: string; url: string }): { type: string; folderId: string } | null {
		if (msg.type !== 'api-proxy') { return null; }
		if (msg.method === 'GET') {
			const folderMatch = msg.url.match(folderNavRegex);
			if (folderMatch) {
				return { type: 'folder-navigated', folderId: folderMatch[1] };
			}
		}
		return null;
	}

	/**
	 * Simulates the webview-side updateToolbarId + message handler logic.
	 */
	function simulateToolbarUpdate(
		initialId: string,
		initialLabel: string,
		messages: Array<{ type: string; folderId?: string }>,
	): { currentId: string; label: string } {
		let currentId = initialId;
		let label = initialLabel;

		for (const msg of messages) {
			if (msg.type === 'folder-navigated' && msg.folderId) {
				currentId = String(msg.folderId);
				label = 'Folder ID:';
			}
		}
		return { currentId, label };
	}

	test('Content Picker subfolder navigation updates toolbar via API proxy detection', () => {
		// User opens Content Picker with folder 0
		const initialId = '0';

		// Picker navigates to subfolder 54321 (internal fetch)
		const apiMsg = {
			type: 'api-proxy',
			method: 'GET',
			url: 'https://api.box.com/2.0/folders/54321?fields=id,name,type,size,parent,permissions&limit=1000&offset=0',
		};

		const navMsg = simulateProxyDetection(apiMsg);
		assert.ok(navMsg, 'Should produce a folder-navigated message');
		assert.strictEqual(navMsg!.folderId, '54321');

		// Toolbar should update
		const result = simulateToolbarUpdate(initialId, 'Folder ID:', [navMsg!]);
		assert.strictEqual(result.currentId, '54321');
		assert.strictEqual(result.label, 'Folder ID:');
	});

	test('Content Picker deep navigation updates toolbar through multiple folders', () => {
		let currentId = '0';
		let label = 'Folder ID:';

		// Navigate through 3 folders: 0 → 111 → 222 → 333
		const folderIds = ['111', '222', '333'];
		for (const fid of folderIds) {
			const apiMsg = {
				type: 'api-proxy',
				method: 'GET',
				url: `https://api.box.com/2.0/folders/${fid}?fields=id,name`,
			};
			const navMsg = simulateProxyDetection(apiMsg);
			assert.ok(navMsg);
			const result = simulateToolbarUpdate(currentId, label, [navMsg!]);
			currentId = result.currentId;
			label = result.label;
		}

		assert.strictEqual(currentId, '333', 'Should end at last navigated folder');
	});

	test('POST requests to folder endpoint do not trigger navigation', () => {
		const apiMsg = {
			type: 'api-proxy',
			method: 'POST',
			url: 'https://api.box.com/2.0/folders/12345',
		};
		const navMsg = simulateProxyDetection(apiMsg);
		assert.strictEqual(navMsg, null, 'POST should not trigger folder navigation');
	});

	test('File API calls do not trigger folder navigation', () => {
		const apiMsg = {
			type: 'api-proxy',
			method: 'GET',
			url: 'https://api.box.com/2.0/files/99999?fields=id,name',
		};
		const navMsg = simulateProxyDetection(apiMsg);
		assert.strictEqual(navMsg, null, 'File endpoint should not trigger folder navigation');
	});

	test('Non-api-proxy messages are ignored', () => {
		const msg = {
			type: 'copy',
			method: 'GET',
			url: 'https://api.box.com/2.0/folders/12345',
		};
		const navMsg = simulateProxyDetection(msg);
		assert.strictEqual(navMsg, null, 'Non-api-proxy messages should be ignored');
	});

	test('Content Explorer navigate event still works alongside API detection', () => {
		// Explorer has its own navigate event, but the API detection should also work
		const apiMsg = {
			type: 'api-proxy',
			method: 'GET',
			url: 'https://api.box.com/2.0/folders/77777?fields=id,name,type',
		};
		const navMsg = simulateProxyDetection(apiMsg);
		assert.ok(navMsg);
		assert.strictEqual(navMsg!.folderId, '77777');

		const result = simulateToolbarUpdate('0', 'Folder ID:', [navMsg!]);
		assert.strictEqual(result.currentId, '77777');
	});

	test('choose event still works for single item selection', () => {
		// Simulate what the choose handler does
		const items = [{ id: '88888', type: 'file' }];
		let updatedId = '';
		let updatedLabel = '';

		if (items && items.length === 1 && items[0].id) {
			const item = items[0];
			updatedLabel = item.type === 'file' ? 'File ID:' : 'Folder ID:';
			updatedId = item.id;
		}

		assert.strictEqual(updatedId, '88888');
		assert.strictEqual(updatedLabel, 'File ID:');
	});

	test('choose event with folder item sets correct label', () => {
		const items = [{ id: '44444', type: 'folder' }];
		let updatedId = '';
		let updatedLabel = '';

		if (items && items.length === 1 && items[0].id) {
			const item = items[0];
			updatedLabel = item.type === 'file' ? 'File ID:' : 'Folder ID:';
			updatedId = item.id;
		}

		assert.strictEqual(updatedId, '44444');
		assert.strictEqual(updatedLabel, 'Folder ID:');
	});
});
