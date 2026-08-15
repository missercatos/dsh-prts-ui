# dsh-prts-ui

> [中文](./README.zh.md)

PRTS is **a GUI shell for [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)** — it is not its own agent. It boots the dsh web backend, opens a window over it, and mirrors dsh's real state: workspaces, sessions, models, credentials, tools and plugins all come from dsh through its `/api` RPC + WebSocket protocol. What PRTS adds is the chrome: the monochrome Arknights-style UI, the particle intro, the system panel, and the voice input.

Because PRTS only speaks dsh's stable `/api` contract, it keeps working across dsh upgrades.

- GUI window over `dsh web` (no separate TUI).
- dsh workspaces + sessions (create / switch / rename / archive), models from `llm.models`.
- Particle welcome intro, system panel (hardware telemetry), voice input, community plugin buttons.

## Install

**One-click installer** (recommended): run `install.sh` on Linux/macOS, or `install.bat` on Windows (`build-exe.bat` wraps it into `PRTS-Setup.exe` via Windows' built-in IExpress). It checks Node.js, **installs dsh if missing (skips if present)**, builds the tarball, installs PRTS into the `prts` profile, and creates the desktop + app-menu shortcuts.

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

# profile side — installs dsh-prts-ui into the `prts` profile
dsh plugin --profile prts install ./dsh-prts-ui-0.1.0.tgz
```

Launch it:

```sh
dsh --profile prts            # opens the PRTS window (boots dsh web underneath)
dsh --profile prts --shortcut # refresh the desktop launcher
```

The `prts` profile is minimal (`bundles: ["dsh-prts-ui"]`): the runner spawns `dsh web` as the backend and opens the PRTS window over it, so PRTS never depends on dsh's internals.

## Usage

```sh
dsh --profile prts                 # GUI window (default)
dsh --profile prts --lang zh       # Chinese GUI
dsh --profile prts --shortcut      # install a desktop launcher
```

Everything about the agent — sessions, models, credentials, tools, plugins, settings — is dsh's, managed in the dsh way. The PRTS window mirrors it: the sidebar lists dsh **workspaces** and **sessions**, the composer sends to the dsh agent, and the model chip shows dsh's model catalog. Sessions are archived (`workspace.archiveSession`) and workspaces deleted (`workspace.delete`) exactly as dsh does.

### Launching `prts` from the terminal

After installing the plugin, add a one-line alias so typing `prts` opens the GUI:

```sh
# add to ~/.bashrc (or ~/.zshrc), then `source ~/.bashrc`
alias prts='/home/a/.dsh/profiles/prts/node_modules/dsh-prts-ui/bin/dsh-prts-ui.js'

prts                  # opens the PRTS window (boots dsh web underneath)
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

### Where data lives

PRTS keeps **only its own window chrome** (theme, locale) in `~/.dsh/profiles/prts/prts-ui.json` (the `prts` profile directory under the dsh home — removed together with the profile). Everything agent-related — workspaces, sessions, history, models, credentials, API keys, tools, plugins — lives in **dsh** (`~/.dsh/`), because PRTS is just a GUI over dsh. Deleting a workspace or archiving a session in PRTS does the corresponding dsh operation (`workspace.delete` / `workspace.archiveSession`).

### Settings → Providers & API keys

The Settings panel lists dsh's providers (`llm.providers`) and, for each, a field to set its API key. Saving calls dsh's `credentials.set`, which writes the key into the dsh harness home (`~/.dsh/`) — the same store dsh reads at runtime, so the key works for every dsh surface, not just PRTS. It is never stored by this plugin. The model chip lists the full dsh model catalog (`llm.models`) and selects via `session.selectModel`, so different providers/models are all usable from the PRTS window.

### Environment variables

| Variable | Meaning |
| --- | --- |
| `PRTS_ELECTRON` | path to a pre-installed Electron binary (skips download) |
| `PRTS_ELECTRON_CACHE` | override the Electron cache dir (default `~/.cache/prts/electron`) |
| `DSH_PRTS_DESKTOP` | desktop dir for `--shortcut` (tests) |
| `DSH_PRTS_NO_SHORTCUT` | `1` disables shortcut install (CI) |
| `DSH_PRTS_PROFILE` | profile name embedded in the shortcut (default `prts`) |
| `DSH_PRTS_DEBUG` | verbose boot traces |

### Platform support

PRTS is written to behave identically on **Linux, macOS and Windows**: the same UI, config layout, per-project history, voice input and system panel run everywhere, and the desktop shortcut targets each platform's native launcher (`.desktop`, `.command`, `.lnk`). The Electron binary is pinned to `43.4.0` and downloaded per platform on first launch. That said, this project is developed and verified on **Linux**; the macOS/Windows paths are implemented but not exercised in CI here, so treat them as best-effort until validated on those systems.

## GUI

The GUI is a single-file web app (`web/index.html`, bundled by `scripts/bundle-gui.mjs`) loaded by `electron/main.cjs`. The renderer talks to the Electron main through `window.prts.bridge`: `prts:systemInfo` (hardware telemetry) and `prts.dsh` (the dsh RPC + mux relay) — the main process speaks dsh's `/api` over HTTP and its `/api/events.mux` WebSocket, so the renderer never hits CORS. The window loads PRTS's own chrome; the agent behind it is dsh.

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

To exercise the GUI against a mock dsh backend without a live dsh (verifies the `/api` + mux protocol), run `node /tmp/opencode/mock-dsh.mjs` and point the Electron window at `http://127.0.0.1:3085`.

## Packaging

`pnpm pack` produces `dsh-prts-ui-0.1.0.tgz` (src, web bundle, electron main, scripts, `cordis.patch.yml`). The `postinstall` script rebuilds the GUI bundle if missing and installs the desktop shortcut (best-effort, never fails the install).

## License

MIT — see [LICENSE](./LICENSE).
