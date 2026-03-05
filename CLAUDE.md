# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run compile        # TypeScript → out/
npm run watch          # Compile in watch mode
npm run lint           # ESLint on src/
npm run test           # Runs vscode-test (requires compile first)
npm run pretest        # compile + lint
```

Tests run via `@vscode/test-cli` and execute compiled JS from `out/test/**/*.test.js`. The test config is in `.vscode-test.mjs`.

To debug: open the project in VS Code and press F5 (launches Extension Development Host).

## Architecture

This is a VS Code extension for the Box platform. It manages OAuth 2.0 connections to Box, browses files/folders, previews content using Box UI Elements, and manages metadata templates.

### Extension Lifecycle

`src/extension.ts` is the entry point. On activation it:
1. Initializes `ext` singleton (`src/extensionVariables.ts`) — shared `ExtensionContext` and `OutputChannel`
2. Sets up the status bar (`src/statusBar/boxStatusBar.ts`)
3. Sets VS Code context keys for command visibility (`src/utils/contextKeys.ts`)
4. Watches for `box-project.json` creation/deletion
5. Registers commands (`src/commands/registerCommands.ts`) and tree views (`src/views/registerViews.ts`)

The extension activates when a workspace contains `box-project.json` (see `activationEvents` in `package.json`).

### Shared State

`ext` namespace in `src/extensionVariables.ts` is the global singleton. Import `ext` to access `context` (ExtensionContext) and `out` (OutputChannel) — do not pass these through function parameters.

### Connection Management

- **Storage**: Connections (`BoxConnection`) are stored in VS Code secrets via `src/utils/connectionStorage.ts`. Connection aliases are tracked in `globalState`.
- **OAuth flow**: `src/commands/connections/authorizeConnection.ts` runs a multi-step input wizard, then starts a local HTTP callback server (`src/utils/oauthServer.ts`) and opens the browser for Box OAuth.
- **Box client**: `src/utils/boxClient.ts` creates a `BoxClient` from the default connection's stored tokens. It uses a custom `TokenStorage` implementation that persists refreshed tokens back to VS Code secrets.
- **Default connection**: Stored in `globalState` as `box.defaultConnection`. The status bar shows the active connection.

### Context Keys (Command Visibility)

Three context keys control when commands appear in the command palette:
- `project.generated` — `box-project.json` exists in workspace
- `box.authenticated` — at least one connection alias stored
- `debug.running` — always set to true on activation

### Tree Views (Sidebar)

Three views live in the "Box" activity bar container (`box-explorer`):
- **All Files** (`src/views/allFilesView.ts`) — paginated folder/file tree from Box API with "Load More" support
- **Configuration** (`src/views/configurationView.ts`) — enterprise and global metadata templates
- **UI Elements** (`src/views/uiElementsView.ts`) — placeholder, currently returns empty

### Webviews

- **Content Preview** (`src/webview/contentPreview.ts`) — renders Box Content Preview using `box-ui-elements` and `box-annotations` loaded from `node_modules`. All network requests are proxied through the extension host via `resources/apiProxyShim.js` to bypass webview CORS restrictions. Uses downscoped tokens.
- **Metadata Template Detail** (`src/webview/metadataTemplateDetail.ts`) — editable form for metadata templates with inline add/remove fields and enum options. Communicates with extension host via `postMessage` for template CRUD operations.

### API Proxy Pattern

The content preview webview cannot make direct network requests. `resources/apiProxyShim.js` replaces both `XMLHttpRequest` and `fetch()` in the webview, routing all requests through `postMessage` to the extension host, which performs the actual `fetch()` and returns responses.

### Project Templates

`src/utils/projectTemplates.ts` defines directory scaffolding for three project types (Empty, Simple, Full) used by the "Create Box Project" command.

## Key Conventions

- All commands use the `box-vscode-extension.` prefix
- Logging goes through `src/utils/output.ts` helpers (`log`, `logCommandHeader`, `printKVTable`) with timestamps
- The SDK used is `box-node-sdk` (v10.x) with `BoxClient`, `BoxOAuth`, `OAuthConfig` imports
- TypeScript strict mode is enabled
- ESLint enforces: camelCase/PascalCase imports, curly braces, `===`, semicolons, no throw literals
