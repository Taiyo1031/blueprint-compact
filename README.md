# Blueprint Compact

Blueprint Compact converts Unreal Engine Blueprint clipboard text into compact JSON, pretty JSON, or Markdown. Everything runs locally in the browser: pasted Blueprint content is never uploaded or saved.

## Use

1. Select Blueprint nodes in Unreal Engine and press `Ctrl + C`.
2. Open Blueprint Compact and press **Convert from Clipboard**. The result is converted to JSON and copied automatically.
3. Copy another set of nodes in Unreal Engine and press the same button on the result screen to replace the current result.
4. Switch to Pretty JSON or Markdown below the preview and press **Copy this format** when needed.
5. `Ctrl + V` anywhere on the page also replaces the current result and copies it automatically. `Ctrl + Enter` copies the current output.

## Features

- Global Blueprint paste handling
- Japanese and English interface
- Compact, Standard, and Full presets
- Compact JSON, pretty JSON, and Markdown export
- Optional AI context included in copied JSON/Markdown by default
- Human-readable node and pin connections
- JSON download without a server
- Settings stored locally, while Blueprint source remains memory-only
- Zero external dependencies

## Run locally

Open `index.html` directly, or serve the folder with any static file server.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

This repository is ready to publish from the `main` branch root:

1. Open **Settings → Pages** in the GitHub repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/(root)`, then save.

No build step is required.

## Privacy

The application does not use a backend, analytics, cookies, IndexedDB, or network requests. Only interface preferences are stored in `localStorage`. Blueprint clipboard text exists only in the current page's memory unless the user downloads the generated JSON.
