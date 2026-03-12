// ─────────────────────────────────────────────────────────────────────────────
// API proxy shim for Box Content Preview webview.
//
// Replaces both XMLHttpRequest and fetch() so that ALL network requests from
// the Box UI Elements library are routed through the VS Code extension host
// via postMessage. This avoids CORS restrictions in the webview sandbox.
//
// Protocol:
//   webview  →  extension host:  { type: 'api-proxy', id, method, url, headers, body }
//   extension host  →  webview:  { type: 'api-proxy-response', id, status, statusText, headers, body, isBinary }
// ─────────────────────────────────────────────────────────────────────────────
(function () {
	'use strict';

	var vscode = acquireVsCodeApi();
	window.__vscodeApi = vscode;
	var pending = {};
	var nextId = 1;

	// ── Shared response listener ─────────────────────────────────────────

	window.addEventListener('message', function (event) {
		var msg = event.data;
		if (msg.type !== 'api-proxy-response') { return; }
		var cb = pending[msg.id];
		if (!cb) { return; }
		delete pending[msg.id];
		cb(msg);
	});

	/**
	 * Sends a proxy request to the extension host and returns a Promise
	 * that resolves with the response message.
	 */
	function sendProxyRequest(method, url, headers, body) {
		var id = nextId++;

		// FormData cannot be cloned via postMessage. Convert it to a
		// serializable representation so the extension host can rebuild
		// the multipart request using Node's built-in fetch().
		if (body && typeof FormData !== 'undefined' && body instanceof FormData) {
			return serializeFormData(body).then(function (result) {
				return new Promise(function (resolve) {
					pending[id] = resolve;
					vscode.postMessage({
						type: 'api-proxy',
						id: id,
						method: method,
						url: url,
						headers: headers,
						formData: result, // Array of { name, value?, fileName?, base64?, type? }
						body: null,
					});
				});
			});
		}

		return new Promise(function (resolve) {
			pending[id] = resolve;
			vscode.postMessage({
				type: 'api-proxy',
				id: id,
				method: method,
				url: url,
				headers: headers,
				body: body || null,
			});
		});
	}

	/**
	 * Serializes a FormData into a cloneable array of entries.
	 * File/Blob values are read as base64 strings.
	 */
	function serializeFormData(fd) {
		var entries = [];
		var promises = [];
		fd.forEach(function (value, name) {
			if (value instanceof Blob) {
				var p = readBlobAsBase64(value).then(function (base64) {
					entries.push({
						name: name,
						base64: base64,
						fileName: value.name || 'blob',
						type: value.type || 'application/octet-stream',
					});
				});
				promises.push(p);
			} else {
				entries.push({ name: name, value: String(value) });
			}
		});
		return Promise.all(promises).then(function () { return entries; });
	}

	function readBlobAsBase64(blob) {
		return new Promise(function (resolve) {
			var reader = new FileReader();
			reader.onloadend = function () {
				// result is "data:<type>;base64,<data>"
				var result = reader.result || '';
				var idx = result.indexOf(',');
				resolve(idx >= 0 ? result.substring(idx + 1) : result);
			};
			reader.readAsDataURL(blob);
		});
	}

	// ── Binary response helpers ──────────────────────────────────────────

	function decodeBase64ToBytes(base64) {
		var binary = atob(base64);
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	// ── XMLHttpRequest proxy ─────────────────────────────────────────────

	function ProxyXHR() {
		this._id = nextId++;
		this._method = 'GET';
		this._url = '';
		this._headers = {};
		this._responseType = '';
		this.readyState = 0;
		this.status = 0;
		this.statusText = '';
		this.response = null;
		this.responseText = '';
		this.onreadystatechange = null;
		this.onload = null;
		this.onerror = null;
		this.onprogress = null;
		this.onloadend = null;
		this.upload = { addEventListener: function () {} };
	}

	ProxyXHR.prototype.open = function (method, url) {
		this._method = method;
		this._url = url;
		this.readyState = 1;
	};

	ProxyXHR.prototype.setRequestHeader = function (key, value) {
		this._headers[key] = value;
	};

	ProxyXHR.prototype.getResponseHeader = function (key) {
		return this._responseHeaders
			? (this._responseHeaders[key.toLowerCase()] || null)
			: null;
	};

	ProxyXHR.prototype.getAllResponseHeaders = function () {
		if (!this._responseHeaders) { return ''; }
		var self = this;
		return Object.keys(this._responseHeaders)
			.map(function (k) { return k + ': ' + self._responseHeaders[k]; })
			.join('\r\n');
	};

	ProxyXHR.prototype.send = function (body) {
		var self = this;
		sendProxyRequest(this._method, this._url, this._headers, body).then(
			function (msg) {
				self.status = msg.status;
				self.statusText = msg.statusText;
				self._responseHeaders = msg.headers;

				if (msg.isBinary && msg.body) {
					var bytes = decodeBase64ToBytes(msg.body);
					var blob = new Blob([bytes], {
						type: (msg.headers['content-type'] || ''),
					});
					if (self._responseType === 'blob') {
						self.response = blob;
					} else if (self._responseType === 'arraybuffer') {
						self.response = bytes.buffer;
					} else {
						self.response = msg.body;
						self.responseText = msg.body;
					}
				} else {
					self.responseText = msg.body;
					self.response =
						(self._responseType === 'json' && msg.body)
							? JSON.parse(msg.body)
							: msg.body;
				}

				self.readyState = 4;
				if (self.onreadystatechange) { self.onreadystatechange(); }
				// A real XMLHttpRequest fires onload for ANY HTTP response (including
				// 4xx/5xx) and only fires onerror for network-level failures (status 0).
				// Axios relies on this: onerror → "Network Error"; onload → checks status.
				if (self.status > 0) {
					if (self.onload) { self.onload(); }
				} else {
					if (self.onerror) { self.onerror(); }
				}
				if (self.onloadend) { self.onloadend(); }
			}
		);
	};

	ProxyXHR.prototype.abort = function () {};

	ProxyXHR.prototype.addEventListener = function (event, handler) {
		if (event === 'readystatechange') { this.onreadystatechange = handler; }
		else if (event === 'load') { this.onload = handler; }
		else if (event === 'error') { this.onerror = handler; }
		else if (event === 'loadend') { this.onloadend = handler; }
		else if (event === 'progress') { this.onprogress = handler; }
	};

	ProxyXHR.prototype.removeEventListener = function () {};

	Object.defineProperty(ProxyXHR.prototype, 'responseType', {
		get: function () { return this._responseType; },
		set: function (v) { this._responseType = v; },
	});

	window.XMLHttpRequest = ProxyXHR;

	// ── fetch() proxy ────────────────────────────────────────────────────

	window.fetch = function (input, init) {
		var url = typeof input === 'string' ? input : input.url;
		var method = (init && init.method) || 'GET';
		var headers = {};
		var body = (init && init.body) || null;

		if (init && init.headers) {
			if (typeof init.headers.forEach === 'function') {
				init.headers.forEach(function (value, key) {
					headers[key] = value;
				});
			} else if (typeof init.headers === 'object') {
				var keys = Object.keys(init.headers);
				for (var i = 0; i < keys.length; i++) {
					headers[keys[i]] = init.headers[keys[i]];
				}
			}
		}

		if (body && typeof body !== 'string') {
			try { body = JSON.stringify(body); }
			catch (_e) { body = String(body); }
		}

		return sendProxyRequest(method, url, headers, body).then(function (msg) {
			var responseBody;
			if (msg.isBinary && msg.body) {
				responseBody = decodeBase64ToBytes(msg.body).buffer;
			} else {
				responseBody = msg.body || null;
			}

			var responseHeaders = new Headers();
			if (msg.headers) {
				var hKeys = Object.keys(msg.headers);
				for (var k = 0; k < hKeys.length; k++) {
					responseHeaders.set(hKeys[k], msg.headers[hKeys[k]]);
				}
			}

			return new Response(responseBody, {
				status: msg.status,
				statusText: msg.statusText,
				headers: responseHeaders,
			});
		});
	};
})();
