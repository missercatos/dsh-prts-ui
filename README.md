# dsh-prts-ui

> [中文](./README.zh.md)

PRTS — a monochrome DeepSeek chat client that **runs on the dsh framework** as a profile bundle. `dsh` is the launching harness: it mounts the profile tree, parses the flags and hands the process lifetime to the app.

- Black/white UI with a particle welcome intro (scatter → welcome → banner → mark).
- Two surfaces from one command: a terminal client (`--tui`) and an Electron window (default).
- Per-project message history, `zh`/`en` locale, deepseek-chat + deepseek-reasoner models, and thinking-strength presets.
- Ships as a `.tgz` profile bundle: `dsh plugin`-installable, desktop-shortcut and postinstall glue included.

## Install

**One-click installer** (recommended): run `install.sh` on Linux/macOS, or `install.bat` on Windows (`build-exe.bat` wraps it into `PRTS-Setup.exe` via Windows' built-in IExpress). It checks Node.js, installs the dsh harness if missing, builds the tarball, installs the plugin into the `prts` profile, creates the desktop + app-menu shortcuts, and puts a `prts` command on PATH.

```sh
# Linux / macOS — from the repo checkout:
bash install.sh
# or with a prebuilt tarball:
bash install.sh ./dsh-prts-ui-0.1.0.tgz

# Windows — double-click install.bat (or PRTS-Setup.exe)
```

Manual install:

```sh
# one-off: build the tarball
pnpm pack

# profile side — this installs dsh-prts-ui into the `prts` profile
dsh plugin --profile prts install ./dsh-prts-ui-0.1.0.tgz
```

Then launch it (any of):

```sh
dsh --profile prts            # GUI window
dsh --profile prts --tui      # terminal client
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

TUI keys: `Enter` send · `Shift+Enter` newline · `Tab` switch view · `Ctrl+L` language · `Ctrl+C` stop/exit · `/help` commands. Settings via `/key`, `/base <url>`, `/model [n|name]`, `/strength off|low|medium|high`, `/mode standard|ptc|minimal|creative`.

### Chat modes & workspaces

A **chat mode** (composer chip, or `/mode` in the TUI) is a dsh-web-style preset applied on top of your model/strength:

| Mode | Effect |
| --- | --- |
| STANDARD | your model + strength, temperature 1.0 |
| PTC | deepseek-chat, thinking off, temperature 0.6 |
| MINIMAL | deepseek-chat, thinking off, temperature 0.2, capped at 400 tokens |
| CREATIVE | deepseek-chat, thinking off, temperature 1.5 |

A **workspace** is what PRTS calls a project: its own history and settings. The button under the PRTS logo shows the current workspace and opens the switcher, where **+ Add workspace** creates a new one (the sidebar "New project" does the same). The default workspace is `default`.

### Launching `prts` from the terminal

After installing the plugin, add a one-line alias so typing `prts` opens the TUI (the bundled `prts` bin defaults to `--tui`):

```sh
# add to ~/.bashrc (or ~/.zshrc), then `source ~/.bashrc`
alias prts='/home/a/.dsh/profiles/prts/node_modules/dsh-prts-ui/bin/dsh-prts-ui.js'
# or the shorter form if dsh lives on PATH and you prefer a shell function:
#   prts() { dsh --profile prts --tui "$@"; }

prts                  # terminal client
prts --lang zh        # Chinese TUI
prts --gui            # GUI window
prts --shortcut       # refresh the desktop shortcut
```

If the package is installed globally (`npm i -g dsh-prts-ui`), the `prts` command is already on PATH and works the same way.

### Desktop shortcut

The desktop launcher is created on demand (and by `postinstall`, best-effort):

```sh
dsh --profile prts --shortcut
```

On Linux this writes **two** entries: `~/Desktop/dsh-prts.desktop` (desktop icon) and `~/.local/share/applications/dsh-prts.desktop` (app menu), both pointed at `dsh --profile prts` with `Icon=` set to the packaged `assets/prts.png`. macOS gets `~/Desktop/PRTS.command`. On **Windows** it writes a `PRTS.lnk` (with the PRTS `.ico` icon) to the Desktop **and** to the Start Menu (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\PRTS.lnk`), launched windowless via `wscript`.

**About the Windows taskbar ("dock"):** Windows deliberately does not let applications pin themselves to the taskbar — that is always a user action. So PRTS won't auto-appear there. The Start-menu entry is what you pin from: Start menu → right-click **PRTS** → **Pin to taskbar**.

**KDE Plasma notes:** make sure your desktop folder matches `XDG_DESKTOP_DIR` (default `~/Desktop`) — if your language localizes it (`~/桌面`), Plasma won't watch `~/Desktop`. The first time you see the desktop icon, right-click it → **Allow Launching**. To pin PRTS to the dock/taskbar, open the app launcher, find **PRTS**, right-click → **Pin to Task Manager** (the app-menu entry is what the dock needs).

Only one launcher is created (a marker file prevents duplicates); remove `~/.config/prts/.shortcut-done` to allow it again, or set `DSH_PRTS_DESKTOP` to target another folder (used in CI).

### Updating

**One-click update** (recommended):

```sh
bash update.sh        # Linux / macOS — from the repo checkout
update.bat            # Windows
# or point either at a newer tarball:
bash update.sh ./dsh-prts-ui-<new-version>.tgz
```

It rebuilds the tarball, updates the plugin inside the `prts` profile, and refreshes the desktop + app-menu shortcuts. The manual equivalent is:

```sh
pnpm bundle && pnpm pack
dsh plugin --profile prts install ./dsh-prts-ui-<new-version>.tgz
rm -f ~/.config/prts/.shortcut-done
dsh --profile prts --shortcut
```

To update the dsh harness itself: `npm i -g @deepseek-ai/dsh@latest`.

### Removing PRTS

```sh
# remove the plugin from the prts profile (forwards to pnpm remove)
dsh plugin --profile prts remove dsh-prts-ui

# clean up shortcuts, config and the profile
rm -f ~/Desktop/dsh-prts.desktop ~/.local/share/applications/dsh-prts.desktop
rm -rf ~/.config/prts ~/.dsh/profiles/prts
# on macOS / Windows remove the matching PRTS.command / .lnk instead.
```

### Where your data and API key live

Everything is stored **locally** under the platform config dir:

| Platform | Config dir |
| --- | --- |
| Linux | `~/.config/prts/` |
| macOS | `~/Library/Application Support/prts/` |
| Windows | `%APPDATA%\prts\` |

- `config.json` — locale, UI theme, and the API settings (`baseUrl`, **`apiKey`**, `model`, `strength`).
- `projects/<id>/meta.json` — per-project metadata.
- `projects/<id>/history.jsonl` — per-project messages and session dividers.

The API key is stored **in `config.json` only, never in a project** (projects hold messages/history only), and it is never sent anywhere except to the `baseUrl` you configure (default `https://api.deepseek.com`) as the `Authorization: Bearer` header. It is plaintext on disk in your own user directory — the same model as most local CLI tools (e.g. `gh`, `aws`). To harden it: keep the config dir permissions restrictive (it is under your home directory) and use an API key with limited quota. Projects and session history are deleted through the trash buttons in the sidebar and the header's clear-history button.

Deleting: hover a project in the sidebar and use the trash button (or the Settings → project delete), and use the header clear-history button to wipe the current project's messages and sessions.

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

### Platform support

PRTS is written to behave identically on **Linux, macOS and Windows**: the same UI, config layout, per-project history, voice input and system panel run everywhere, and the desktop shortcut targets each platform's native launcher (`.desktop`, `.command`, `.lnk`). The Electron binary is pinned to `43.4.0` and downloaded per platform on first launch. That said, this project is developed and verified on **Linux**; the macOS/Windows paths are implemented but not exercised in CI here, so treat them as best-effort until validated on those systems.

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
