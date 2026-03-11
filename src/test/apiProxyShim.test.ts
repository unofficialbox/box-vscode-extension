import * as assert from 'assert';

/**
 * Tests for the FormData serialization logic used in apiProxyShim.js.
 * Since the shim runs in a webview (browser context), we replicate the
 * serialization algorithm here to test it in Node.
 */

interface SerializedEntry {
	name: string;
	value?: string;
	base64?: string;
	fileName?: string;
	type?: string;
}

/** Replicates the serialization logic for non-Blob entries */
function serializeStringEntry(name: string, value: string): SerializedEntry {
	return { name, value: String(value) };
}

/** Replicates the base64 decode logic from the shim */
function decodeBase64ToBytes(base64: string): Uint8Array {
	const buf = Buffer.from(base64, 'base64');
	return new Uint8Array(buf);
}

/** Replicates FormData reconstruction logic from the extension host */
function reconstructFormData(entries: SerializedEntry[]): Array<{ name: string; value: string | { buffer: Buffer; fileName: string; type: string } }> {
	const result: Array<{ name: string; value: string | { buffer: Buffer; fileName: string; type: string } }> = [];
	for (const entry of entries) {
		if (entry.base64) {
			const buf = Buffer.from(entry.base64, 'base64');
			result.push({
				name: entry.name,
				value: {
					buffer: buf,
					fileName: entry.fileName || 'blob',
					type: entry.type || 'application/octet-stream',
				},
			});
		} else {
			result.push({ name: entry.name, value: entry.value ?? '' });
		}
	}
	return result;
}

suite('API Proxy Shim Logic', () => {
	suite('String entry serialization', () => {
		test('serializes string value', () => {
			const entry = serializeStringEntry('field1', 'hello');
			assert.strictEqual(entry.name, 'field1');
			assert.strictEqual(entry.value, 'hello');
			assert.strictEqual(entry.base64, undefined);
		});

		test('converts number to string', () => {
			const entry = serializeStringEntry('count', String(42));
			assert.strictEqual(entry.value, '42');
		});
	});

	suite('Base64 decoding', () => {
		test('decodes base64 to bytes correctly', () => {
			const original = 'Hello, World!';
			const base64 = Buffer.from(original).toString('base64');
			const bytes = decodeBase64ToBytes(base64);
			const decoded = Buffer.from(bytes).toString('utf-8');
			assert.strictEqual(decoded, original);
		});

		test('handles empty base64', () => {
			const bytes = decodeBase64ToBytes('');
			assert.strictEqual(bytes.length, 0);
		});

		test('handles binary data roundtrip', () => {
			const binaryData = new Uint8Array([0, 1, 2, 255, 128, 64]);
			const base64 = Buffer.from(binaryData).toString('base64');
			const decoded = decodeBase64ToBytes(base64);
			assert.deepStrictEqual(decoded, binaryData);
		});
	});

	suite('FormData reconstruction', () => {
		test('reconstructs string entries', () => {
			const entries: SerializedEntry[] = [
				{ name: 'field1', value: 'hello' },
				{ name: 'field2', value: 'world' },
			];
			const result = reconstructFormData(entries);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].value, 'hello');
			assert.strictEqual(result[1].value, 'world');
		});

		test('reconstructs binary entries from base64', () => {
			const content = 'file content here';
			const base64 = Buffer.from(content).toString('base64');
			const entries: SerializedEntry[] = [
				{ name: 'file', base64, fileName: 'test.txt', type: 'text/plain' },
			];
			const result = reconstructFormData(entries);
			assert.strictEqual(result.length, 1);
			const fileEntry = result[0].value as { buffer: Buffer; fileName: string; type: string };
			assert.strictEqual(fileEntry.fileName, 'test.txt');
			assert.strictEqual(fileEntry.type, 'text/plain');
			assert.strictEqual(fileEntry.buffer.toString('utf-8'), content);
		});

		test('handles mixed string and binary entries', () => {
			const entries: SerializedEntry[] = [
				{ name: 'attributes', value: '{"name":"file.pdf","parent":{"id":"0"}}' },
				{ name: 'file', base64: Buffer.from('pdf data').toString('base64'), fileName: 'file.pdf', type: 'application/pdf' },
			];
			const result = reconstructFormData(entries);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(typeof result[0].value, 'string');
			assert.strictEqual(typeof result[1].value, 'object');
		});

		test('defaults fileName to blob and type to octet-stream', () => {
			const entries: SerializedEntry[] = [
				{ name: 'file', base64: Buffer.from('data').toString('base64') },
			];
			const result = reconstructFormData(entries);
			const fileEntry = result[0].value as { buffer: Buffer; fileName: string; type: string };
			assert.strictEqual(fileEntry.fileName, 'blob');
			assert.strictEqual(fileEntry.type, 'application/octet-stream');
		});

		test('handles empty entries array', () => {
			const result = reconstructFormData([]);
			assert.strictEqual(result.length, 0);
		});
	});
});
