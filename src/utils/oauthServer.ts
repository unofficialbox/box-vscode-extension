import * as http from 'http';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { log } from './output';

// ─── Active server lifecycle ───────────────────────────────────────────────────

let activeCallbackServer: http.Server | null = null;

/** Gracefully closes the active OAuth callback server and clears the reference. */
export function closeActiveServer(): void {
	if (activeCallbackServer) {
		try { activeCallbackServer.close(); } catch { /* already closed */ }
		activeCallbackServer = null;
	}
}

// ─── Result types ────────────────────────────────────────────────────────────

export interface OAuthCallbackResult {
	code: string;
	/** Call with user info once available; renders final page and shuts down server. */
	complete: (info: CallbackUserInfo) => void;
	/** Call on error after receiving the code (e.g. token exchange failure). */
	fail: (message: string) => void;
}

export interface CallbackUserInfo {
	userName: string;
	userLogin: string;
	userId: string;
	enterpriseId: string;
}

// ─── OAuth callback helper ────────────────────────────────────────────────────

/**
 * Starts a local HTTP callback server, opens the given authorization URL in
 * the browser, waits for the OAuth redirect, and resolves with the auth code
 * plus a `complete()` handle to finalize the browser page with user info.
 *
 * Any previously-running server is closed before the new one is started.
 */
export function waitForOAuthCallback(callbackUrl: string, authUrl: string, expectedState?: string): Promise<OAuthCallbackResult> {
	return new Promise<OAuthCallbackResult>((resolve, reject) => {
		const parsedUrl    = new URL(callbackUrl);
		const callbackPort = parseInt(
			parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
			10
		);
		const callbackPath = parsedUrl.pathname;

		closeActiveServer();

		// Holds the final HTML that the browser polls for
		let finalHtml: string | null = null;

		const server = http.createServer((req, res) => {
			const reqUrl = new URL(
				req.url ?? '',
				`${parsedUrl.protocol}//${parsedUrl.hostname}:${callbackPort}`
			);

			// Poll endpoint — browser JS fetches this until final HTML is ready
			if (reqUrl.pathname === '/__status') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				if (finalHtml) {
					res.end(JSON.stringify({ ready: true, html: finalHtml }));
				} else {
					res.end(JSON.stringify({ ready: false }));
				}
				return;
			}

			if (reqUrl.pathname !== callbackPath) {
				res.writeHead(404);
				res.end();
				return;
			}

			const code             = reqUrl.searchParams.get('code');
			const state            = reqUrl.searchParams.get('state');
			const error            = reqUrl.searchParams.get('error');
			const errorDescription = reqUrl.searchParams.get('error_description');

			// Validate CSRF state parameter
			if (expectedState && state !== expectedState) {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end(getCallbackHtml(false, 'Invalid OAuth state parameter. This may be a CSRF attack.'));
				clearTimeout(oauthTimeout);
				shutdownServer();
				const errMsg = 'OAuth state mismatch — possible CSRF attack';
				log(ext.out, `Authorization failed: ${errMsg}`);
				reject(new Error(errMsg));
				return;
			}

			// OAuth error — render immediately
			if (error || !code) {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end(getCallbackHtml(false, errorDescription ?? error ?? 'Unknown error'));

				clearTimeout(oauthTimeout);
				shutdownServer();

				const errMsg = errorDescription ?? error ?? 'Unknown error during authorization';
				log(ext.out, `Authorization failed: ${errMsg}`);
				reject(new Error(errMsg));
				return;
			}

			// Success — render loading page; it will poll /__status for final content
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(getLoadingHtml());

			clearTimeout(oauthTimeout);

			// Auto-shutdown after 30s in case complete/fail is never called
			const completeTimeout = setTimeout(() => shutdownServer(), 30_000);

			resolve({
				code,
				complete: (info: CallbackUserInfo) => {
					finalHtml = getCallbackHtml(true, undefined, info);
					// Give the browser a few seconds to poll, then shut down
					setTimeout(() => { clearTimeout(completeTimeout); shutdownServer(); }, 5_000);
				},
				fail: (message: string) => {
					finalHtml = getCallbackHtml(false, message);
					setTimeout(() => { clearTimeout(completeTimeout); shutdownServer(); }, 5_000);
				},
			});
		});

		function shutdownServer(): void {
			try { server.close(); } catch { /* already closed */ }
			activeCallbackServer = null;
		}

		activeCallbackServer = server;

		// Auto-close after 5 minutes if the browser flow is never completed
		const oauthTimeout = setTimeout(() => {
			shutdownServer();
			log(ext.out, 'Authorization timed out after 5 minutes.');
			reject(new Error('Authorization timed out. Please try again.'));
		}, 5 * 60 * 1000);

		server.on('error', (err: Error) => {
			clearTimeout(oauthTimeout);
			activeCallbackServer = null;
			log(ext.out, `Callback server error on port ${callbackPort}: ${err.message}`);
			vscode.window.showErrorMessage(
				`Failed to start callback server on port ${callbackPort}: ${err.message}. ` +
				`Ensure the port is free and the redirect URI matches your Box app settings.`
			);
			reject(err);
		});

		server.listen(callbackPort, () => {
			log(ext.out, `Callback server listening on port ${callbackPort}.`);
			vscode.env.openExternal(vscode.Uri.parse(authUrl));
		});
	});
}

// ─── Box wordmark SVG (Box Blue #0061D5) ─────────────────────────────────────

const BOX_LOGO_SVG = `<svg width="80" height="28" viewBox="25 41 78 42" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M28.7666 41.9564C30.3145 41.9564 31.5725 43.1913 31.6005 44.7337V56.6711C33.9755 54.891 36.9188 53.8372 40.1048 53.8372C45.5306 53.8372 50.2467 56.887 52.6236 61.3649C54.9998 56.887 59.7182 53.8372 65.1403 53.8372C72.963 53.8372 79.309 60.1792 79.309 68.0041C79.309 75.8327 72.963 82.1762 65.1403 82.1762C59.7182 82.1762 54.9998 79.1236 52.6236 74.65C50.2467 79.1236 45.5306 82.1762 40.1048 82.1762C32.3549 82.1762 26.0654 75.9586 25.9406 68.2403H25.9375V44.7337C25.973 43.1913 27.2187 41.9564 28.7666 41.9564ZM96.3731 55.1189C97.4158 53.9073 99.3063 53.6679 100.654 54.602C102 55.5284 102.279 57.2717 101.304 58.5204L93.5933 67.9856L101.295 77.4326C102.272 78.6847 101.991 80.4231 100.645 81.3531C99.2976 82.2835 97.4074 82.0466 96.3636 80.8332L89.7391 72.7139L83.1107 80.8332C82.0789 82.0466 80.1765 82.2835 78.833 81.3531C77.4896 80.4231 77.2089 78.6847 78.1885 77.4326H78.1859L85.8831 67.9856L78.1859 58.5204H78.1885C77.2089 57.2717 77.4896 55.5292 78.833 54.602C80.1765 53.6679 82.0789 53.9073 83.1107 55.1189V55.1169L89.7391 63.2475L96.3731 55.1169V55.1189ZM65.1403 59.5098C60.4449 59.5098 56.6377 63.3127 56.6377 68.0041C56.6377 72.6995 60.4449 76.5032 65.1403 76.5032C69.8337 76.5032 73.6389 72.6995 73.6389 68.0041C73.6389 63.3127 69.8337 59.5098 65.1403 59.5098ZM40.1048 59.5098C35.4103 59.5098 31.6005 63.3127 31.6005 68.0059C31.6005 72.7005 35.4103 76.5032 40.1048 76.5032C44.7987 76.5032 48.6006 72.6995 48.6006 68.0041C48.6006 63.3127 44.7987 59.5098 40.1048 59.5098Z" fill="#0061D5"/>
</svg>`;

// ─── Shared CSS ──────────────────────────────────────────────────────────────

const SHARED_CSS = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f5f7fa;
    color: #333;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    padding: 48px 40px;
    max-width: 520px;
    width: 100%;
    text-align: center;
  }
  .icon-circle {
    width: 72px; height: 72px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
  }
  .icon-circle.success { background: rgba(38,194,129,0.12); }
  .icon-circle.error   { background: rgba(231,76,60,0.12); }
  .icon-circle svg { width: 36px; height: 36px; }
  h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 8px;
    color: #1a1a2e;
  }
  .subtitle {
    font-size: 0.95rem;
    line-height: 1.5;
    color: #6b7280;
    margin-bottom: 24px;
  }
  .info-block {
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 8px;
    padding: 18px 22px;
    margin-bottom: 24px;
    text-align: left;
    font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 0.82rem;
    line-height: 1.7;
    color: #cdd6f4;
    overflow-x: auto;
    white-space: pre;
  }
  .info-block .punct { color: #6c7086; }
  .info-block .key   { color: #89b4fa; }
  .info-block .str   { color: #a6e3a1; }
  .box-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: #9ca3af;
  }
`;

// ─── Loading page HTML ───────────────────────────────────────────────────────

function getLoadingHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Authorizing...</title>
<style>
  ${SHARED_CSS}
  .spinner {
    width: 48px; height: 48px;
    border: 4px solid #e5e7eb;
    border-top-color: #0061D5;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 24px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="card" id="card">
    <div class="spinner"></div>
    <h1>Completing Authorization</h1>
    <p class="subtitle">Exchanging credentials and verifying your account...</p>
    <div class="box-badge">${BOX_LOGO_SVG} for VS Code</div>
  </div>
  <script>
  (function poll() {
    fetch('/__status').then(function(r) { return r.json(); }).then(function(d) {
      if (d.ready) {
        document.open();
        document.write(d.html);
        document.close();
      } else {
        setTimeout(poll, 500);
      }
    }).catch(function() { setTimeout(poll, 1000); });
  })();
  </script>
</body>
</html>`;
}

// ─── Final callback page HTML ────────────────────────────────────────────────

function getCallbackHtml(success: boolean, errorDetail?: string, userInfo?: CallbackUserInfo): string {
	const title = success ? 'Authorization Successful' : 'Authorization Failed';
	const message = success
		? 'You are now connected. You can close this tab and return to VS Code.'
		: `Something went wrong: ${esc(errorDetail ?? 'Unknown error')}`;
	const iconColor = success ? '#26C281' : '#E74C3C';
	const iconPath = success
		? 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
		: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

	let infoBlock = '';
	if (success && userInfo) {
		const jsonLines = [
			`<span class="punct">{</span>`,
			`  <span class="key">"userName"</span><span class="punct">:</span>     <span class="str">"${esc(userInfo.userName)}"</span><span class="punct">,</span>`,
			`  <span class="key">"userLogin"</span><span class="punct">:</span>    <span class="str">"${esc(userInfo.userLogin)}"</span><span class="punct">,</span>`,
			`  <span class="key">"userId"</span><span class="punct">:</span>       <span class="str">"${esc(userInfo.userId)}"</span><span class="punct">,</span>`,
			`  <span class="key">"enterpriseId"</span><span class="punct">:</span> <span class="str">"${esc(userInfo.enterpriseId || '')}"</span>`,
			`<span class="punct">}</span>`,
		];
		infoBlock = `<div class="info-block">${jsonLines.join('\n')}</div>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${SHARED_CSS}</style>
</head>
<body>
  <div class="card">
    <div class="icon-circle ${success ? 'success' : 'error'}">
      <svg viewBox="0 0 24 24" fill="${iconColor}"><path d="${iconPath}"/></svg>
    </div>
    <h1>${title}</h1>
    <p class="subtitle">${message}</p>
    ${infoBlock}
    <div class="box-badge">${BOX_LOGO_SVG} for VS Code</div>
  </div>
</body>
</html>`;
}

function esc(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
