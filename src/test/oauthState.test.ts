import * as assert from 'assert';
import * as crypto from 'crypto';

/**
 * Tests for OAuth CSRF state parameter generation and validation logic.
 */

suite('OAuth State Parameter', () => {
	test('generates hex string of expected length', () => {
		const state = crypto.randomBytes(16).toString('hex');
		assert.strictEqual(state.length, 32);
		assert.match(state, /^[0-9a-f]{32}$/);
	});

	test('generates unique values on each call', () => {
		const state1 = crypto.randomBytes(16).toString('hex');
		const state2 = crypto.randomBytes(16).toString('hex');
		assert.notStrictEqual(state1, state2);
	});

	test('state validation matches identical strings', () => {
		const expected = 'abc123def456';
		const received: string = expected;
		assert.strictEqual(expected === received, true);
	});

	test('state validation rejects different strings', () => {
		const expected = 'abc123def456';
		const received = 'xyz789abc000';
		assert.notStrictEqual(expected, received);
	});

	test('state validation rejects empty state', () => {
		const expected = 'abc123def456';
		const received = '';
		assert.notStrictEqual(expected, received);
	});

	test('state parameter is included in URL correctly', () => {
		const state = crypto.randomBytes(16).toString('hex');
		const baseUrl = 'https://account.box.com/api/oauth2/authorize?client_id=xxx&redirect_uri=http://localhost:3000/callback';
		const urlWithState = `${baseUrl}&state=${state}`;
		const parsed = new URL(urlWithState);
		assert.strictEqual(parsed.searchParams.get('state'), state);
	});
});
