# Box VS Code Extension

A VS Code extension for the [Box Platform](https://www.box.com/platform) that brings file browsing, content preview, metadata management, deployment workflows, and Box UI Elements directly into your editor.

## Features

### Project Scaffolding

- **Create Box Project** — Scaffold a new Box project in your workspace with one of three templates:
  - **Minimal** — `metadata-templates/` and `metadata-taxonomies` directories
  - **Standard** — Adds a `folders/` directory
  - **Full** — Adds `automate/`, `apps/`, `ai_agents/`, `sign/`, `hubs/`, `enterprise_configuration/`, `dev_app_configurations/`, `shield/`, and more
- Generates a `box-project.json` file that activates the extension automatically

### Connection Management (OAuth 2.0)

- **Authorize Connection** — Multi-step OAuth 2.0 wizard that launches a local callback server and opens the browser for authorization
- **Multiple Connections** — Store and manage multiple Box connections with unique aliases
- **Default Connection** — Set and switch the active default connection; shown in the status bar
- **Display Connections** — View all stored connections or the current default in the output channel
- **Remove Connection** — Delete a saved connection with confirmation
- **Get Access Token** — Refresh and copy the current access token to clipboard

All credentials are stored securely using VS Code's encrypted secret storage.

### File Browsing & Preview

- **All Files** sidebar view — Paginated folder/file tree starting from the root of your Box account with "Load More" support
- **Content Preview** — Preview files in a webview powered by Box UI Elements (`box-ui-elements` and `box-annotations`), with downscoped tokens for security
- **API Proxy** — All webview network requests are routed through the extension host via `postMessage` to bypass CORS restrictions

### Metadata Template Management

- **Configuration** sidebar view — Browse enterprise and global metadata templates in a tree hierarchy
- **Template Detail Webview** — View and edit templates with inline field management:
  - Add/remove fields (string, date, float, integer, enum, multiSelect)
  - Add/remove enum and multiSelect options
  - Toggle hidden and copyInstanceOnItemCopy flags
- **Create Metadata Template** — Create new enterprise-scoped templates via a dedicated form
- **Copy to Clipboard** / **Save Template JSON** — Export template data for local use

### Metadata Taxonomy Management

- **Taxonomy Tree** — Hierarchical display of taxonomies with levels and nodes in the Configuration sidebar
- **Taxonomy Detail Webview** — View and edit taxonomies:
  - Add/remove levels
  - Manage nodes with parent-child relationships
  - Update display names
  - Delete nodes or entire taxonomies
- **Create Metadata Taxonomy** — Create new enterprise-scoped taxonomies
- **Copy to Clipboard** / **Save Taxonomy JSON** — Export taxonomy data

### Deploy to Box Enterprise

- **Deploy to Default Box Enterprise** — Deploy metadata templates and taxonomies from local JSON files to the default connection's enterprise
- **Deploy to Target Box Enterprise** — Select any stored connection and deploy to that enterprise
- Supports both creating new and updating existing templates/taxonomies
- Available from the **explorer context menu** (right-click on JSON files or `metadata-templates`/`metadata-taxonomies` directories) and the **command palette**
- Batch deployment with per-file progress notifications

### Diff and Deploy

- **Diff and Deploy to Default Box Enterprise** — Preview a side-by-side diff of local vs. remote state before deploying
- **Diff and Deploy to Target Box Enterprise** — Same workflow with target enterprise selection
- Unified diff view with color-coded additions, removals, and unchanged lines
- **Deploy** button to proceed or **Cancel** to abort; webview closes automatically on successful deploy
- Available from both explorer context menus and the command palette

### UI Elements

- **UI Elements** sidebar view with five integrated Box UI Elements:
  - **Content Uploader** — Upload files to a Box folder
  - **Content Picker** — Pick files or folders
  - **Content Preview** — Preview a specific file
  - **Content Explorer** — Browse files and folders
  - **Metadata Query Builder** — Build and execute metadata queries with an interactive form

### Metadata Query Builder

- Interactive query builder webview with template-aware field autocomplete
- Execute metadata queries against the Box API
- **HTTP tab** — View raw JSON results with a filter input to search by key or value (always preserves `id` and `type` fields)
- **UI Element tab** — Render query results in the Box Content Explorer with metadata columns
- Copy request JSON to clipboard
- Paginated results with "Next Page" support

### Developer App Creation

- **Create Box Developer Application** — Create a new Box developer application by providing just an app name
- Uses the default connection to call the Box API and returns the new app's ID and client ID

## Requirements

- [Node.js](https://nodejs.org/) 18+
- A Box account with a configured OAuth 2.0 application in the [Box Developer Console](https://app.box.com/developers/console)
- The OAuth 2.0 redirect URI in your Box app must match the extension's callback URL (default: `http://localhost:3000/callback`)

## Extension Settings

This extension contributes the following settings:

- `box.clientId` — Box application Client ID (from the Box Developer Console)
- `box.clientSecret` — Box application Client Secret (from the Box Developer Console)
- `box.callbackUrl` — Full OAuth 2.0 redirect URI; must match the redirect URI registered in your Box app (default: `http://localhost:3000/callback`)

## Commands

All commands use the `box-vscode-extension.` prefix and are available through the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| Box: Create Box Project | Scaffold a new Box project in the workspace |
| Box: Authorize Connection (OAuth 2.0) | Start the OAuth 2.0 authorization flow |
| Box: Display All Box Connections | List all stored connections |
| Box: Display the Default Box Connection | Show the current default connection |
| Box: Set the Default Box Connection | Change the default connection |
| Box: Remove Box Connection | Delete a stored connection |
| Box: Get Access Token | Refresh and copy the access token |
| Box: Create Box Developer Application | Create a new Box developer app |
| Box: Deploy to Default Box Enterprise | Deploy metadata to the default enterprise |
| Box: Deploy to Target Box Enterprise | Deploy metadata to a selected enterprise |
| Box: Diff and Deploy to Default Box Enterprise | Preview diff then deploy to default |
| Box: Diff and Deploy to Target Box Enterprise | Preview diff then deploy to target |

## Build & Development

```bash
npm run compile        # TypeScript -> out/
npm run watch          # Compile in watch mode
npm run lint           # ESLint on src/
npm run test           # Run tests (requires compile first)
npm run pretest        # compile + lint
```

To debug: open the project in VS Code and press **F5** to launch the Extension Development Host.

## Release Notes

### 0.0.1

- Initial release with project scaffolding, OAuth 2.0 connection management, file browsing, content preview, metadata template and taxonomy CRUD, deployment workflows, diff and deploy preview, Box UI Elements integration, metadata query builder, and developer app creation.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
