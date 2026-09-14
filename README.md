# Blueprint Compact

Blueprint Compact converts Unreal Engine Blueprint, Material / Material Function, and PCG clipboard text into compact JSON, pretty JSON, or Markdown. Everything runs locally in the browser: pasted node content is never uploaded or saved.

## Use

1. Select Blueprint, Material, or PCG nodes in Unreal Engine and press `Ctrl + C`. Graph type is detected automatically.
2. Open Blueprint Compact and press **Convert from Clipboard**. The result is converted to JSON and copied automatically.
3. Copy another set of nodes in Unreal Engine and press the same button on the result screen to replace the current result.
4. Switch to Pretty JSON or Markdown below the preview and press **Copy this format** when needed.
5. `Ctrl + V` anywhere on the page also replaces the current result and copies it automatically. `Ctrl + Enter` copies the current output.

## Features

- Global node paste handling
- Material expressions, parameters, indexed properties, and Named Reroute object references
- PCG settings, nested selectors/packers, user parameters, and dependency-only connections
- Japanese and English interface
- Bilingual usage and internal-process guide
- Compact, Standard, and Full presets
- Compact JSON, pretty JSON, and Markdown export
- Optional AI context included in copied JSON/Markdown by default
- Human-readable node and pin connections
- JSON download without a server
- Settings stored locally, while Blueprint source remains memory-only
- Zero external dependencies

## Support / 対応範囲

Blueprint has dedicated node/pin parsing. Material and PCG retain nested implementation objects and serialized settings. Properties are Unreal text values, not evaluated values. Object references are separate from pin wires. JSON connections include pin IDs to disambiguate repeated labels.

Blueprint・Material・PCGの種類を自動判別します。MaterialとPCGは内部オブジェクト・設定値を階層付きで保持します。Named Reroute参照は通常の接続と区別します。

Only copied nodes are available. External asset internals and omitted engine defaults cannot be recovered. This is an AI-oriented summary, not lossless storage or Unreal import text. Niagara and other pin-based graph text use **unverified generic extraction** with warnings, not dedicated support. Engine versions and plugin formats may differ. PCG connections use editor pin links; internal PCGEdge objects are omitted as duplicate transport data.

コピー範囲のみの要約で、参照先アセットの内部や省略された既定値は取得できません。Niagara等は警告付きの未検証な汎用抽出です。完全保存・Unrealへの再インポート用ではありません。

## Tests

Run `node --test tests/*.test.cjs`. Optional local sample checks accept `MATERIAL_SAMPLE` and `PCG_SAMPLE` environment variables containing file paths. Supplied samples and their asset contents are not included in this public repository.

## Local server

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
