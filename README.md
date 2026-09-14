# Blueprint Compact

Blueprint Compact converts Unreal Engine Blueprint clipboard text into compact JSON, pretty JSON, or Markdown. Everything runs locally in the browser: pasted Blueprint content is never uploaded or saved.

## Use

1. Select Blueprint nodes in Unreal Engine and press `Ctrl + C`.
2. Open Blueprint Compact and press `Ctrl + V` anywhere on the page.
3. Choose an output preset or format if needed.
4. Press **Copy**. `Ctrl + Enter` also copies the current output.

## Features

- Global Blueprint paste handling
- Japanese and English interface
- Compact, Standard, and Full presets
- Compact JSON, pretty JSON, and Markdown export
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
