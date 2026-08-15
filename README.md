# dsh-prts-ui

> [中文](./README.zh.md)

PRTS — a monochrome DeepSeek chat client that lives inside the [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) harness as a profile bundle.

- Black/white UI with a particle welcome intro (scatter → welcome → logo → hero).
- Two surfaces from one command: a terminal client (`--tui`) and an Electron window (default).
- Per-project message history, `zh`/`en` locale, deepseek-chat + deepseek-reasoner models, and thinking-strength presets.
- Ships as a `.tgz` profile bundle: `dsh plugin`-installable, desktop-shortcut and postinstall glue included.

## Install

```sh
# one-off: build the tarball
pnpm pack

# profile side
dsh plugin --profile prts install ./dsh-prts-ui-0.1.0.tgz
dsh --profile prts --tui
```

The profile (`~/.dsh/profiles/prts/`) uses a **minimal bundle** — only `dsh-prts-ui`, not `@deepseek-ai/dsh-base`:

```json
{
  "dsh": { "profile": { "bundles": ["dsh-prts-ui"] } }
}
```

PRTS is a self-contained leaf client (direct DeepSeek API via `fetch`, its own store and history) and does not need the agent shell, sandbox or host services that `dsh-base` mounts. Keeping the tree minimal also avoids the harness's full-tree boot cost — the app is ready as soon as the startup selection and launcher IO exist.

## Usage

```sh
dsh --profile prts                 # GUI window (default)
dsh --profile prts --tui           # terminal client
dsh --profile prts --tui --lang en # English UI
dsh --profile prts --tui --project ops
dsh --profile prts --shortcut      # install a desktop launcher
```

TUI keys: `Enter` send · `Tab` switch view · `Ctrl+L` language · `Ctrl+C` stop/exit · `/help` commands. Settings via `/key`, `/base <url>`, `/model [n|name]`, `/strength off|low|medium|high`.

Configuration and history live in the platform config dir (`~/.config/prts` on Linux, `~/Library/Application Support/prts` on macOS, `%APPDATA%\prts` on Windows): `config.json`, `projects/<id>/meta.json`, `projects/<id>/history.jsonl`.

### Environment variables

| Variable | Meaning |
| --- | --- |
| `DSH_PRTS_READY_TIMEOUT` | ms to bound the loader-readiness wait (default `4000`; `0` = wait forever) |
| `PRTS_ELECTRON` | path to a pre-installed Electron binary (skips download) |
| `PRTS_ELECTRON_CACHE` | override the Electron cache dir (default `~/.cache/prts/electron`) |
| `DSH_PRTS_DESKTOP` | desktop dir for `--shortcut` (tests) |
| `DSH_PRTS_NO_SHORTCUT` | `1` disables shortcut install (CI) |
| `DSH_PRTS_PROFILE` | profile name embedded in the shortcut (default `prts`) |
| `DSH_PRTS_DEBUG` | verbose boot traces |

## GUI

The GUI is a single-file web app (`web/index.html`, bundled by `scripts/bundle-gui.mjs`) loaded by `electron/main.cjs`. The renderer talks to the main process through `window.prts.bridge` (`prts:readFile`, `prts:writeFile`, `prts:http`, `prts:systemInfo`, …) so persistence, API calls and hardware telemetry avoid CORS.

Electron is not packed into the plugin: the first GUI launch downloads the pinned release (GitHub Releases primary, npmmirror fallback) and caches it under `~/.cache/prts/electron/v43.4.0`. Set `PRTS_ELECTRON` to a system Electron to skip the download.

### Voice input

The mic button in the composer (bottom-right) toggles voice input. When enabled the app captures the microphone, runs voice-activity detection, and auto-starts speech recognition on sustained human voice (finalizing on silence). While listening, the PRTS brand mark shows a live line-wave driven by the mic level and spectrum. Speech recognition uses the platform `SpeechRecognition` API; a community plugin can override the engine.

### System panel

Click the PRTS brand mark (top-left) to open the system panel. Left: a slow-rotating composed-circle — just a few long, rounded arc segments, phased apart so no two rings align, Arknights flat style. Right: fastfetch/btop-style telemetry in one space divided by hairlines — hardware (OS, host, CPU, load, GPU, memory, swap, disk, CPU power, thermal zones) and the agent (model, mode, tokens used/left, sessions, messages). Live metrics (memory/swap/disk %, CPU load & power, temperatures, token usage) ease toward their targets at 30fps so the numbers and bars flow continuously, refreshed over `prts:systemInfo` every 1.5s.

The particle intro holds longer (≈12s, skippable) and reuses the same particles throughout — a scattered field reorganizes into a tracked-out **welcome to / PRTS** wordmark, then morphs into the **PRTS · DEEPSEEK** banner, then into the square diamond mark (no scatter, no fade), each centred at a modern-browser aspect ratio.

### Composer

The input is borderless — only the white caret marks the field. **Enter sends, Shift+Enter inserts a newline**, and the box keeps a fixed height with wheel-scrolling (the current line stays pinned at the bottom). Above it, a faint Arknights-style toggle — an up-triangle with a notch and three flowing dots — expands the input upward to a height limit without moving the PRTS brand.

### Community plugin buttons

PRTS is the dsh harness UI, so it keeps dsh's extensibility. Plugins register buttons through the shared namespace; nothing renders unless a plugin registers, so a stock install shows no extra buttons.

```js
PRTS.plugins.register({
  id: 'my-plugin',
  area: 'composer',          // 'composer' | 'header'
  order: 10,
  icon: '<svg ...></svg>',   // inline SVG, currentColor
  label: 'Vision',
  onClick(ctx) { /* ctx = { app, config, store, chat } */ },
})
```

A host may pre-seed plugins by setting `window.PRTS_PLUGINS` to an array before boot; each is adopted on boot. Speech-recognition engines can be overridden with `area: 'asr'` and an `engine` object exposing `start`/`stop`/`setLang`. See `src/gui/plugins.js` for the full contract.

### Brand mark

The desktop launcher and the Electron window use `assets/prts.png` — a transparent square diamond: a pure-white diamond outline, italic **P · R / T · S** corner letters, and a small italic **PRTS** wordmark with an accent rule across the centre, in the Arknights/eagle-network line style. The source is `assets/prts.svg`.

## Development

```sh
pnpm install
pnpm bundle        # rebuild web/index.html from src/gui + src/core + web/src
pnpm pack:ui       # bundle + pack the profile tarball
```

For local e2e against a mock DeepSeek endpoint:

```sh
node /tmp/opencode/mock-sse.mjs     # SSE chat server on 127.0.0.1:8127
printf 'apiKey=sk-test-123\nbaseUrl=http://127.0.0.1:8127\n'   # via /key and /base in the TUI
dsh --profile prts --tui
```

## Packaging

`pnpm pack` produces `dsh-prts-ui-0.1.0.tgz` (src, web bundle, electron main, scripts, `cordis.patch.yml`). The `postinstall` script rebuilds the GUI bundle if missing and installs the desktop shortcut (best-effort, never fails the install).

## License

MIT — see [LICENSE](./LICENSE).
