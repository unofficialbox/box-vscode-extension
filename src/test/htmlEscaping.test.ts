import * as assert from 'assert';

/**
 * Tests for the HTML escaping function used across all webview files.
 * Verifies that user-controlled data is properly escaped to prevent XSS.
 */

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

suite('HTML Escaping', () => {
	test('escapes ampersand', () => {
		assert.strictEqual(esc('a&b'), 'a&amp;b');
	});

	test('escapes less-than', () => {
		assert.strictEqual(esc('<script>'), '&lt;script&gt;');
	});

	test('escapes greater-than', () => {
		assert.strictEqual(esc('a>b'), 'a&gt;b');
	});

	test('escapes double quotes', () => {
		assert.strictEqual(esc('"hello"'), '&quot;hello&quot;');
	});

	test('handles empty string', () => {
		assert.strictEqual(esc(''), '');
	});

	test('handles string with no special chars', () => {
		assert.strictEqual(esc('Hello World 123'), 'Hello World 123');
	});

	test('escapes multiple special chars in one string', () => {
		assert.strictEqual(esc('<div class="test">&nbsp;</div>'),
			'&lt;div class=&quot;test&quot;&gt;&amp;nbsp;&lt;/div&gt;');
	});

	test('prevents script injection', () => {
		const malicious = '<script>alert("XSS")</script>';
		const escaped = esc(malicious);
		assert.ok(!escaped.includes('<script>'));
		assert.ok(!escaped.includes('</script>'));
	});

	test('prevents attribute injection', () => {
		const malicious = '" onload="alert(1)';
		const escaped = esc(malicious);
		assert.ok(!escaped.includes('"'));
	});

	test('handles nested escaping correctly', () => {
		// Already-escaped content should be double-escaped
		assert.strictEqual(esc('&amp;'), '&amp;amp;');
	});

	test('JSON.stringify + replace prevents script tag injection in embedded data', () => {
		// This tests the pattern used in webview HTML generation:
		// JSON.stringify(data).replace(/<\//g, '<\\/')
		const data = { name: '</script><script>alert(1)</script>' };
		const safe = JSON.stringify(data).replace(/<\//g, '<\\/');
		assert.ok(!safe.includes('</script>'));
	});
});
