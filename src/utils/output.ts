import * as vscode from 'vscode';

// ─── Timestamp ────────────────────────────────────────────────────────────────

/** Returns the current date-time as YYYY-MM-DD HH:MM:SS. */
export function timestamp(): string {
	const now  = new Date();
	const date = now.toLocaleDateString('en-CA');                           // YYYY-MM-DD
	const time = now.toLocaleTimeString('en-US', { hour12: false });        // HH:MM:SS
	return `${date} ${time}`;
}

// ─── Token redaction ──────────────────────────────────────────────────────────

/** Replaces all but the last 4 characters of a token with asterisks. */
export function redactToken(token: string): string {
	if (token.length <= 4) { return '****'; }
	return '*'.repeat(token.length - 4) + token.slice(-4);
}

// ─── Log helpers ──────────────────────────────────────────────────────────────

/** Appends a timestamped message to the output channel. */
export function log(out: vscode.OutputChannel, message: string): void {
	out.appendLine(`[${timestamp()}] ${message}`);
}

/**
 * Appends a clearly-delimited header block that marks the start of a new
 * command execution, making individual runs easy to locate in the log history.
 */
export function logCommandHeader(out: vscode.OutputChannel, commandName: string): void {
	const ts   = timestamp();
	const rule = '─'.repeat(52);
	out.appendLine('');
	out.appendLine(`[${ts}] ${rule}`);
	out.appendLine(`[${ts}] ▶  ${commandName}`);
	out.appendLine(`[${ts}] ${rule}`);
}

// ─── Table rendering ──────────────────────────────────────────────────────────

/**
 * Builds a Unicode box-drawing table and returns it as an array of lines.
 *
 * @param title   Optional banner row spanning all columns (null to omit).
 * @param headers Column header labels (null to omit the header row).
 * @param rows    Data rows.
 */
export function buildTable(
	title: string | null,
	headers: string[] | null,
	rows: string[][]
): string[] {
	const allRows  = headers ? [headers, ...rows] : rows;
	const colCount = Math.max(...allRows.map(r => r.length), 1);

	const widths = Array.from({ length: colCount }, (_, i) =>
		Math.max(...allRows.map(r => (r[i] ?? '').length), 1)
	);

	const hLine = (l: string, j: string, r: string): string =>
		l + widths.map(w => '─'.repeat(w + 2)).join(j) + r;

	const dataRow = (cells: string[]): string =>
		'│' + cells.map((c, i) => ` ${(c ?? '').padEnd(widths[i])} `).join('│') + '│';

	const lines: string[] = [];

	if (title) {
		const innerWidth = widths.reduce((a, b) => a + b + 3, 0) - 3;
		lines.push(`┌${'─'.repeat(innerWidth + 2)}┐`);
		lines.push(`│ ${title.padEnd(innerWidth)} │`);
		lines.push(hLine('├', '┬', '┤'));
	} else {
		lines.push(hLine('┌', '┬', '┐'));
	}

	if (headers) {
		lines.push(dataRow(headers));
		lines.push(hLine('├', '┼', '┤'));
	}

	rows.forEach(r => lines.push(dataRow(r)));
	lines.push(hLine('└', '┴', '┘'));

	return lines;
}

/** Prints a table to the output channel (blank lines before and after). */
export function printTable(
	out: vscode.OutputChannel,
	title: string | null,
	headers: string[] | null,
	rows: string[][]
): void {
	if (rows.length === 0) { return; }
	out.appendLine('');
	buildTable(title, headers, rows).forEach(line => out.appendLine(line));
	out.appendLine('');
}

/** Prints a two-column key/value table (no header row) to the output channel. */
export function printKVTable(
	out: vscode.OutputChannel,
	title: string | null,
	rows: [string, string][]
): void {
	printTable(out, title, null, rows);
}
